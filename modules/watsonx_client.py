"""
Watsonx Client — thin wrapper around ibm-watsonx-ai for text generation.
One IBM API call per user query (system + history + user + RAG context).
"""

import os
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


class WatsonxClient:
    """
    Manages authentication and generation against IBM Watsonx.ai.
    Token is refreshed automatically by the SDK.
    """

    def __init__(
        self,
        api_key: str,
        project_id: str,
        url: str = "https://us-south.ml.cloud.ibm.com",
        model_id: str = "ibm/granite-3-3-8b-instruct",
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ):
        self.api_key = api_key
        self.project_id = project_id
        self.url = url
        self.model_id = model_id
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._client = None
        self._model = None

    def _ensure_client(self):
        """Lazy initialisation — only imports and connects when first needed."""
        if self._model is not None:
            return

        try:
            from ibm_watsonx_ai import APIClient, Credentials
            from ibm_watsonx_ai.foundation_models import ModelInference
            from ibm_watsonx_ai.metanames import GenTextParamsMetaNames as GenParams

            credentials = Credentials(
                api_key=self.api_key,
                url=self.url,
            )
            self._client = APIClient(credentials)
            self._model = ModelInference(
                model_id=self.model_id,
                api_client=self._client,
                project_id=self.project_id,
                params={
                    GenParams.MAX_NEW_TOKENS: self.max_tokens,
                    GenParams.TEMPERATURE: self.temperature,
                    GenParams.TOP_P: 0.9,
                    GenParams.REPETITION_PENALTY: 1.1,
                    GenParams.STOP_SEQUENCES: ["<|endoftext|>", "<|end_of_turn|>"],
                },
            )
            logger.info(f"Watsonx client initialised — model: {self.model_id}")

        except ImportError:
            raise RuntimeError(
                "ibm-watsonx-ai package not installed. "
                "Run: pip install ibm-watsonx-ai"
            )
        except Exception as exc:
            logger.error(f"Watsonx initialisation failed: {exc}")
            raise

    def generate(
        self,
        system_prompt: str,
        user_message: str,
        history: Optional[List[dict]] = None,
        max_history: int = 6,
    ) -> str:
        """
        Generate a response using a single API call.

        Builds the full conversation as a structured prompt:
          <system>...</system>
          <|user|>...</|user|>
          <|assistant|>...</|assistant|>
          ... (last max_history turns)
          <|user|>[current message]<|assistant|>

        Args:
            system_prompt:  Full system prompt from agent_instructions.
            user_message:   Current user message (may include RAG context prefix).
            history:        List of {"role": "user"|"assistant", "content": str}.
            max_history:    Number of recent turns to include (keeps tokens low).

        Returns:
            Generated text string.
        """
        self._ensure_client()

        # Truncate history to last N turns (N/2 user + N/2 assistant)
        trimmed_history = (history or [])[-max_history:]

        # Build Granite chat prompt using <|user|>/<|assistant|> tokens
        prompt_parts = [f"<|system|>\n{system_prompt}\n<|end_of_text|>"]

        for turn in trimmed_history:
            role = turn.get("role", "user")
            content = turn.get("content", "").strip()
            if role == "user":
                prompt_parts.append(f"\n<|user|>\n{content}\n<|end_of_text|>")
            else:
                prompt_parts.append(f"\n<|assistant|>\n{content}\n<|end_of_text|>")

        # Current user turn
        prompt_parts.append(f"\n<|user|>\n{user_message}\n<|end_of_text|>\n<|assistant|>")

        full_prompt = "".join(prompt_parts)

        try:
            response = self._model.generate_text(prompt=full_prompt)
            # Strip any trailing special tokens the model may echo
            result = response.strip()
            for stop_token in ["<|end_of_text|>", "<|endoftext|>", "<|end_of_turn|>"]:
                result = result.replace(stop_token, "").strip()
            return result

        except Exception as exc:
            logger.error(f"Watsonx generation error: {exc}")
            raise

    def health_check(self) -> dict:
        """Test connectivity and return status info."""
        try:
            self._ensure_client()
            # Quick minimal generation
            test = self._model.generate_text(
                prompt="<|user|>\nSay 'OK' in one word.\n<|end_of_text|>\n<|assistant|>"
            )
            return {"status": "ok", "model": self.model_id, "response": test[:50]}
        except Exception as exc:
            return {"status": "error", "error": str(exc)}


# ── Singleton factory ──────────────────────────────────────────────────────
_client_instance: Optional[WatsonxClient] = None


def get_watsonx_client() -> WatsonxClient:
    global _client_instance
    if _client_instance is None:
        api_key = os.getenv("IBM_API_KEY", "")
        project_id = os.getenv("IBM_PROJECT_ID", "")
        url = os.getenv("IBM_WATSONX_URL", "https://us-south.ml.cloud.ibm.com")
        model_id = os.getenv("GRANITE_MODEL_ID", "ibm/granite-3-3-8b-instruct")
        max_tokens = int(os.getenv("MAX_TOKENS", "1024"))
        temperature = float(os.getenv("TEMPERATURE", "0.7"))

        if not api_key or api_key == "your_ibm_cloud_api_key_here":
            raise ValueError(
                "IBM_API_KEY not set. Copy .env.example to .env and fill in your credentials."
            )
        if not project_id or project_id == "your_watsonx_project_id_here":
            raise ValueError(
                "IBM_PROJECT_ID not set. Copy .env.example to .env and fill in your credentials."
            )

        _client_instance = WatsonxClient(
            api_key=api_key,
            project_id=project_id,
            url=url,
            model_id=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    return _client_instance
