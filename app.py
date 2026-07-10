"""
Interview Trainer Agent — Flask Application
Main entry point: initialises RAG, wires up routes, starts the server.
"""

import os
import uuid
import json
import logging
from datetime import datetime
from pathlib import Path

from flask import Flask, render_template, request, jsonify, session
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# ── Load environment variables first ──────────────────────────────────────
load_dotenv()

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── Flask app factory ──────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-change-in-production")
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_CONTENT_LENGTH", 10 * 1024 * 1024))

UPLOAD_FOLDER = Path(os.getenv("UPLOAD_FOLDER", "uploads"))
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "txt"}

# ── Lazy-loaded singletons (initialised on first request) ─────────────────
_rag = None
_watsonx = None

MAX_HISTORY = int(os.getenv("MAX_HISTORY_MESSAGES", "6"))


def _get_rag():
    global _rag
    if _rag is None:
        from modules.rag_engine import get_rag_engine
        _rag = get_rag_engine(
            kb_dir=os.getenv("KNOWLEDGE_BASE_DIR", "knowledge_base"),
            vector_db_path=os.getenv("VECTOR_DB_PATH", "vector_db"),
            embedding_model=os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2"),
            top_k=int(os.getenv("TOP_K_RESULTS", "5")),
        )
    return _rag


def _get_watsonx():
    global _watsonx
    if _watsonx is None:
        from modules.watsonx_client import get_watsonx_client
        _watsonx = get_watsonx_client()
    return _watsonx


def _allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ──────────────────────────────────────────────────────────────────────────
#  Session helpers
# ──────────────────────────────────────────────────────────────────────────

def _get_session_id() -> str:
    if "session_id" not in session:
        session["session_id"] = str(uuid.uuid4())[:8]
    return session["session_id"]


def _get_history() -> list:
    return session.get("history", [])


def _save_history(history: list) -> None:
    session["history"] = history[-MAX_HISTORY:]


def _get_user_profile() -> dict:
    return session.get("user_profile", {})


def _get_resume_text() -> str:
    return session.get("resume_text", "")


def _get_scores() -> dict:
    return session.get("scores", {
        "interview_readiness": 0,
        "resume_score": 0,
        "technical_score": 0,
        "communication_score": 0,
    })


def _save_session_record(user_msg: str, ai_msg: str) -> None:
    """Persist a brief record of the session for the dashboard."""
    records = session.get("session_records", [])
    records.append({
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "preview": user_msg[:80],
        "response_preview": ai_msg[:80],
        "profile": _get_user_profile().get("job_role", "General"),
    })
    session["session_records"] = records[-20:]  # keep last 20


# ──────────────────────────────────────────────────────────────────────────
#  Score estimation helper (heuristic, not ML)
# ──────────────────────────────────────────────────────────────────────────

def _estimate_scores(profile: dict, resume_text: str, history: list) -> dict:
    scores = _get_scores()

    # Resume score — based on available data
    if resume_text:
        word_count = len(resume_text.split())
        base = 50
        base += min(20, word_count // 50)
        base += 10 if any(c.isdigit() for c in resume_text) else 0  # has numbers
        base += 10 if "github" in resume_text.lower() or "linkedin" in resume_text.lower() else 0
        scores["resume_score"] = min(base, 95)

    # Technical score — based on skills
    skills = profile.get("skills", "")
    if isinstance(skills, str):
        skills_lower = skills.lower()
        technical_kws = ["python", "java", "javascript", "sql", "aws", "docker",
                         "kubernetes", "react", "node", "machine learning", "data structures"]
        match_count = sum(1 for kw in technical_kws if kw in skills_lower)
        scores["technical_score"] = min(40 + match_count * 5, 90)

    # Communication score — based on profile completeness
    filled_fields = sum(1 for f in ["job_role", "experience_level", "skills", "target_company"]
                        if profile.get(f))
    scores["communication_score"] = min(30 + filled_fields * 12 + len(history) * 2, 88)

    # Interview readiness — composite
    if any(scores.values()):
        filled = [v for v in scores.values() if v > 0]
        scores["interview_readiness"] = int(sum(filled) / len(filled)) if filled else 0

    return scores


# ──────────────────────────────────────────────────────────────────────────
#  Routes — Pages
# ──────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    _get_session_id()
    return render_template(
        "index.html",
        session_id=_get_session_id(),
        user_profile=_get_user_profile(),
        scores=_get_scores(),
    )


# ──────────────────────────────────────────────────────────────────────────
#  Routes — API
# ──────────────────────────────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Main chat endpoint.
    Accepts: { message, profile? }
    Returns: { response, session_id, scores }
    One Watsonx API call per request.
    """
    data = request.get_json(silent=True) or {}
    user_message = (data.get("message") or "").strip()

    if not user_message:
        return jsonify({"error": "Empty message"}), 400

    # Update profile if provided
    if data.get("profile"):
        session["user_profile"] = {**_get_user_profile(), **data["profile"]}

    user_profile = _get_user_profile()
    history = _get_history()
    resume_text = _get_resume_text()

    try:
        # 1. RAG retrieval
        rag = _get_rag()
        retrieved_context = rag.retrieve(user_message)

        # 2. Build prompts
        from modules.agent_instructions import build_system_prompt, build_rag_context_block
        system_prompt = build_system_prompt(user_profile, resume_text)
        rag_block = build_rag_context_block(retrieved_context)

        # 3. Compose augmented user message (RAG context + actual message)
        augmented_message = user_message
        if rag_block:
            augmented_message = rag_block + "\n\nCandidate question: " + user_message

        # 4. Single Watsonx call
        watsonx = _get_watsonx()
        response_text = watsonx.generate(
            system_prompt=system_prompt,
            user_message=augmented_message,
            history=history,
            max_history=MAX_HISTORY,
        )

        # 5. Update session history (store clean message, not RAG-augmented)
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": response_text})
        _save_history(history)
        _save_session_record(user_message, response_text)

        # 6. Update scores
        scores = _estimate_scores(user_profile, resume_text, history)
        session["scores"] = scores

        return jsonify({
            "response": response_text,
            "session_id": _get_session_id(),
            "scores": scores,
        })

    except ValueError as exc:
        # Missing credentials
        logger.warning(f"Configuration error: {exc}")
        return jsonify({"error": str(exc)}), 503

    except Exception as exc:
        logger.exception(f"Chat error: {exc}")
        return jsonify({"error": "AI service temporarily unavailable. Please try again."}), 500


@app.route("/api/upload-resume", methods=["POST"])
def upload_resume():
    """Upload and parse a resume file. Stores text in session for RAG context."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file or file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    if not _allowed_file(file.filename):
        return jsonify({"error": "File type not allowed. Use PDF, DOCX, DOC, or TXT."}), 400

    filename = secure_filename(file.filename)
    unique_name = f"{_get_session_id()}_{filename}"
    file_path = UPLOAD_FOLDER / unique_name

    try:
        file.save(str(file_path))
        from modules.resume_parser import parse_resume
        result = parse_resume(str(file_path))

        if not result["success"]:
            file_path.unlink(missing_ok=True)
            return jsonify({"error": result["error"]}), 422

        # Store resume text in session
        session["resume_text"] = result["text"]

        # Add to RAG index
        rag = _get_rag()
        rag.add_document(result["text"], source=f"resume:{filename}")

        # Update profile with detected skills
        meta = result.get("metadata", {})
        if meta.get("detected_skills"):
            profile = _get_user_profile()
            existing = profile.get("skills", "")
            if not existing:
                profile["skills"] = ", ".join(meta["detected_skills"])
                session["user_profile"] = profile

        # Update scores
        scores = _estimate_scores(_get_user_profile(), result["text"], _get_history())
        session["scores"] = scores

        # Clean up file after parsing
        file_path.unlink(missing_ok=True)

        return jsonify({
            "success": True,
            "filename": filename,
            "word_count": result["word_count"],
            "detected_skills": meta.get("detected_skills", [])[:10],
            "years_experience": meta.get("years_experience"),
            "scores": scores,
            "message": f"Resume parsed successfully ({result['word_count']} words). Ready to give personalised advice!",
        })

    except Exception as exc:
        logger.exception(f"Resume upload error: {exc}")
        file_path.unlink(missing_ok=True)
        return jsonify({"error": "Failed to process resume. Please try again."}), 500


@app.route("/api/update-profile", methods=["POST"])
def update_profile():
    """Update user profile (job role, experience, skills, target company)."""
    data = request.get_json(silent=True) or {}
    allowed_fields = {"job_role", "experience_level", "skills", "target_company"}
    profile = _get_user_profile()
    for field in allowed_fields:
        if field in data and data[field] is not None:
            profile[field] = data[field]
    session["user_profile"] = profile

    scores = _estimate_scores(profile, _get_resume_text(), _get_history())
    session["scores"] = scores

    return jsonify({"success": True, "profile": profile, "scores": scores})


@app.route("/api/clear-chat", methods=["POST"])
def clear_chat():
    """Clear conversation history (keep profile and resume)."""
    session["history"] = []
    return jsonify({"success": True, "message": "Chat cleared"})


@app.route("/api/set-history", methods=["POST"])
def set_history():
    """Set active conversation history (used when loading a saved session)."""
    data = request.get_json(silent=True) or {}
    session["history"] = data.get("history", [])
    scores = _estimate_scores(_get_user_profile(), _get_resume_text(), _get_history())
    session["scores"] = scores
    return jsonify({"success": True, "scores": scores})


@app.route("/api/delete-session-record", methods=["POST"])
def delete_session_record():
    """Delete a session record from session memory."""
    data = request.get_json(silent=True) or {}
    record_id = data.get("id")
    if not record_id:
        return jsonify({"error": "Missing record ID"}), 400
    
    records = session.get("session_records", [])
    session["session_records"] = [r for r in records if r.get("id") != record_id]
    return jsonify({"success": True, "message": "Session record deleted"})


@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    """Return dashboard data: scores + session history."""
    scores = _estimate_scores(_get_user_profile(), _get_resume_text(), _get_history())
    session["scores"] = scores
    return jsonify({
        "scores": scores,
        "profile": _get_user_profile(),
        "session_records": session.get("session_records", [])[-10:],
        "total_messages": len(_get_history()) // 2,
        "has_resume": bool(_get_resume_text()),
    })


@app.route("/api/health", methods=["GET"])
def health():
    """Health check — verifies RAG is loaded (Watsonx tested lazily)."""
    try:
        rag = _get_rag()
        return jsonify({
            "status": "ok",
            "rag_chunks": len(rag._chunks),
            "rag_ready": rag._ready,
            "model": os.getenv("GRANITE_MODEL_ID", "ibm/granite-3-3-8b-instruct"),
        })
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


# ──────────────────────────────────────────────────────────────────────────
#  Error handlers
# ──────────────────────────────────────────────────────────────────────────

@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": "File too large. Maximum size is 10 MB."}), 413


@app.errorhandler(404)
def not_found(_):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(_):
    return jsonify({"error": "Internal server error"}), 500


# ──────────────────────────────────────────────────────────────────────────
#  Entry point
# ──────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    logger.info(f"Starting Interview Trainer on port {port} (debug={debug})")
    app.run(host="0.0.0.0", port=port, debug=debug)
