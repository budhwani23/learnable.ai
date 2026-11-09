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
