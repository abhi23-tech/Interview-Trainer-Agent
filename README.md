# InterviewAI — AI-Powered Interview Trainer

> Built with **IBM Watsonx.ai Granite 4.0 MoE** · **FAISS RAG** · **Flask** · **Dark Theme UI**

A production-ready, ChatGPT-style interview coaching web app that helps candidates ace technical, HR, behavioural, and company-specific interviews using IBM's Granite foundation models with retrieval-augmented generation (RAG).

---

## ✨ Features

| Feature | Details |
|---|---|
| 🤖 AI Coach | IBM Granite 4.0 MoE (granite-4-h-small) via Watsonx.ai |
| 📚 RAG Engine | FAISS + sentence-transformers (MiniLM-L6) |
| 📄 Resume Upload | PDF, DOCX, DOC, TXT parsing with skill extraction |
| 🎯 Personalisation | Role, experience, company, skills profile |
| 📊 Dashboard | Readiness / Resume / Technical / Communication scores |
| 💬 Chat UI | ChatGPT-style dark theme, markdown, code highlighting |
| 🏢 Company-Specific | Google, Amazon, Microsoft, Meta, Apple, IBM guides |
| 🔒 Secure | `.env` credentials, session-scoped data |

---

## 🗂️ Project Structure

```
interview-trainer/
├── app.py                          # Flask application entry point
├── .env.example                    # Environment variable template
├── requirements.txt
│
├── modules/
│   ├── __init__.py
│   ├── agent_instructions.py       # ← CUSTOMISE: personality, difficulty, style
│   ├── rag_engine.py               # FAISS vector store + retrieval
│   ├── resume_parser.py            # PDF/DOCX/TXT extraction
│   └── watsonx_client.py           # IBM Watsonx.ai wrapper (1 call/query)
│
├── knowledge_base/                 # Plain-text RAG source documents
│   ├── technical_questions.txt
│   ├── hr_behavioral_questions.txt
│   ├── coding_questions.txt
│   ├── company_specific.txt
│   ├── resume_guide.txt
│   └── system_design.txt
│
├── vector_db/                      # Auto-generated FAISS index (git-ignored)
├── uploads/                        # Temp resume files (git-ignored)
│
├── templates/
│   └── index.html                  # Single-page app shell
│
└── static/
    ├── css/style.css               # Dark theme + glassmorphism
    └── js/app.js                   # Chat UI, markdown, dashboard
```

---

## 🚀 Quick Start

### 1 · Prerequisites

- Python 3.10+
- IBM Cloud account with Watsonx.ai access
- IBM API Key + Project ID

### 2 · Clone and install

```bash
git clone <repo-url>
cd interview-trainer
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 3 · Configure credentials

```bash
# Copy the example and fill in your values
cp .env.example .env
```

Edit `.env`:

```env
IBM_API_KEY=your_ibm_cloud_api_key
IBM_PROJECT_ID=your_watsonx_project_id
IBM_WATSONX_URL=https://us-south.ml.cloud.ibm.com
FLASK_SECRET_KEY=your-random-secret-key
GRANITE_MODEL_ID=ibm/granite-4-h-small
```

### 4 · Run

```bash
python app.py
```

Open **http://localhost:5000**

The FAISS index is built automatically from the `knowledge_base/` files on first startup (~30 seconds). Subsequent startups load the saved index instantly.

---

## 🔑 Getting IBM Credentials

1. **Create IBM Cloud account**: https://cloud.ibm.com/registration
2. **Create API Key**: IBM Cloud → Manage → Access (IAM) → API keys → Create
3. **Create Watsonx project**: https://dataplatform.cloud.ibm.com/projects → New project
4. **Get Project ID**: Project → Manage → General → Project ID
5. **Ensure Watsonx.ai service** is associated with your project

---

## 🎨 Customising the Agent

Edit [`modules/agent_instructions.py`](modules/agent_instructions.py) to change:

```python
# Personality
AGENT_NAME = "Alex"              # Change the coach's name
AGENT_PERSONALITY = "..."        # Modify tone and background

# Difficulty
DIFFICULTY = "adaptive"          # "easy" | "medium" | "hard" | "adaptive"

# Industry
INDUSTRY_FOCUS = "software_engineering"  # See INDUSTRY_CONTEXTS dict

# Company focus
TARGET_COMPANY = "Google"        # Or None for generic

# Response verbosity
RESPONSE_VERBOSITY = "balanced"  # "concise" | "balanced" | "detailed"
```

---

## 📚 Extending the Knowledge Base

Add any `.txt` file to the `knowledge_base/` directory, then delete the `vector_db/` folder and restart the app to rebuild the index.

```bash
# Add new content
echo "Your interview content here" > knowledge_base/new_topic.txt

# Rebuild index
rm -rf vector_db/
python app.py
```

---

## 🌐 Production Deployment

### Gunicorn (Linux/macOS)

```bash
pip install gunicorn
gunicorn -w 2 -b 0.0.0.0:5000 --timeout 120 app:app
```

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "--timeout", "120", "app:app"]
```

```bash
docker build -t interview-trainer .
docker run -p 5000:5000 --env-file .env interview-trainer
```

### IBM Code Engine (Serverless)

```bash
ibmcloud login
ibmcloud target -r us-south -g Default
ibmcloud code-engine project create --name interview-trainer
ibmcloud code-engine app create \
  --name interview-ai \
  --image us.icr.io/mynamespace/interview-trainer \
  --env-from-secret my-secrets
```

### Environment Variables for Production

```env
FLASK_DEBUG=False
FLASK_ENV=production
FLASK_SECRET_KEY=<strong-random-64-char-key>
MAX_HISTORY_MESSAGES=6
MAX_TOKENS=1024
```

---

## 🛡️ Security Notes

- `.env` is git-ignored — never commit credentials
- Sessions are server-side (Flask session cookie)
- Uploaded resumes are deleted after parsing
- No resume data stored in databases
- Rate-limit in production using Flask-Limiter

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Send message, get AI response |
| `POST` | `/api/upload-resume` | Upload + parse resume file |
| `POST` | `/api/update-profile` | Update user profile |
| `POST` | `/api/clear-chat` | Clear conversation history |
| `GET`  | `/api/dashboard` | Fetch scores + session data |
| `GET`  | `/api/health` | Health check |

### `/api/chat` request body
```json
{
  "message": "Ask me a system design question",
  "profile": {
    "job_role": "Software Engineer",
    "experience_level": "Senior (5-8 years)",
    "skills": "Python, AWS, Kubernetes",
    "target_company": "Google"
  }
}
```

---

## 🧑‍💻 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, Flask 3.0 |
| AI | IBM Watsonx.ai, Granite 4.0 MoE (granite-4-h-small) |
| RAG | FAISS, sentence-transformers (all-MiniLM-L6-v2) |
| Resume | PyMuPDF, python-docx, pdfplumber |
| Frontend | Bootstrap 5.3, Vanilla JS, marked.js, highlight.js |
| Styling | Custom CSS, CSS variables, glassmorphism |

---

## 📄 License

MIT License — See [LICENSE](LICENSE) for details.

---

*Made with ❤️ using IBM Watsonx.ai Granite*
