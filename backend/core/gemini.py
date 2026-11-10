# core/gemini.py
import os
from typing import Dict, Any, Tuple
from langchain_core.messages import HumanMessage
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import Tool
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.output_parsers import StrOutputParser
from dotenv import load_dotenv
load_dotenv()


class GeminiService:
    def __init__(self, model_name: str = "gemini-3-flash-preview", temperature: float = 0.7):
        """
        Initialize Gemini client through LangChain.
        Ensures GOOGLE_API_KEY is present in environment.
        """
        if not os.getenv("GOOGLE_API_KEY"):
            raise ValueError("Missing GOOGLE_API_KEY in environment")

        self.model_name = model_name
        self.llm: BaseChatModel = ChatGoogleGenerativeAI(
            model=model_name,
            temperature=temperature,
        )
        self.parser = StrOutputParser()

    def run_prompt(self, system_prompt: str, user_input: str) -> str:
        """
        Build a simple system+user prompt and return string output.
        Backwards-compatible, returns only the content.
        """
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "{input}")
        ])

        chain = prompt | self.llm | self.parser
        return chain.invoke({"input": user_input})

    def run_raw(self, prompt_text: str) -> str:
        """Run a plain text prompt. Keeps old behavior (content only)."""
        return self.llm.invoke([HumanMessage(content=prompt_text)]).content

    def run_raw_with_usage(self, prompt_text: str) -> Tuple[str, Dict[str, Any]]:
        """
        Run a plain text prompt and also return usage metadata for credit accounting.
        Returns a tuple (content, usage_dict).
        If usage metadata isn't available, usage_dict may be empty.
        """
        ai_msg = self.llm.invoke([HumanMessage(content=prompt_text)])
        # Attempt to extract usage metadata from the response
        usage = getattr(ai_msg, "usage_metadata", None) or getattr(ai_msg, "response_metadata", {}) or {}
        content = ai_msg.content
        return content, usage

    def as_tool(self, name="gemini_tool", description="LLM-based assistant"):
        """Wrap Gemini as a LangChain Tool for agent use."""
        return Tool(
            name=name,
            func=self.run_raw,
            description=description
        )


CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
DEFAULT_CEREBRAS_MODEL = "qwen-3.8-27b"


class CerebrasService(GeminiService):
    """
    Text-only LLM on Cerebras (OpenAI-compatible API), e.g. qwen-3.8-27b.

    Same interface as GeminiService (run_prompt / run_raw / run_raw_with_usage / .llm),
    so text generation can switch providers without touching callers. It cannot read
    audio, video, images, PDFs or URLs: keep those on GeminiService.
    """

    def __init__(self, model_name: str | None = None, temperature: float = 0.7):
        from langchain_openai import ChatOpenAI  # imported lazily: only needed with a Cerebras key

        api_key = os.getenv("CEREBRAS_API_KEY")
        if not api_key:
            raise ValueError("Missing CEREBRAS_API_KEY in environment")
        self.model_name = model_name or os.getenv("CEREBRAS_MODEL", DEFAULT_CEREBRAS_MODEL)
        self.llm: BaseChatModel = ChatOpenAI(
            model=self.model_name,
            api_key=api_key,
            base_url=os.getenv("CEREBRAS_BASE_URL", CEREBRAS_BASE_URL),
            temperature=temperature,
            # Reasoning model: leave room for its hidden reasoning plus the answer.
            max_completion_tokens=int(os.getenv("CEREBRAS_MAX_TOKENS", "16000")),
            timeout=int(os.getenv("CEREBRAS_TIMEOUT", "120")),
            max_retries=4,  # retries 429/5xx with backoff
        )
        self.parser = StrOutputParser()

    def run_prompt(self, system_prompt: str, user_input: str) -> str:
        return super().run_prompt(system_prompt, user_input).strip()

    def run_raw(self, prompt_text: str) -> str:
        return (super().run_raw(prompt_text) or "").strip()


def get_text_service(temperature: float = 0.7) -> GeminiService:
    """
    The LLM for plain-text generation (summaries, mindmaps, quizzes, flashcards,
    explainer scripts): Cerebras when CEREBRAS_API_KEY is set, otherwise Gemini.
    """
    if os.getenv("CEREBRAS_API_KEY"):
        return CerebrasService(temperature=temperature)
    return GeminiService(model_name="gemini-3-flash-preview", temperature=temperature)
