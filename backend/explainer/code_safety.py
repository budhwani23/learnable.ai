"""
Static safety gate for LLM-generated Manim scene code.

The scene code is written by an LLM whose prompt contains student-supplied
material (documents, transcripts, free text). That material could try to steer
the model into emitting code that touches the filesystem, network or shell.
Before anything is executed we parse the code and reject constructs a Manim
scene never needs.

This is a defence-in-depth filter, not a sandbox. For production, also run the
render subprocess in an isolated container / low-privilege user.
"""
import ast
from typing import List

ALLOWED_IMPORTS = {"numpy", "math", "random", "manim", "itertools", "functools"}

FORBIDDEN_NAMES = {
    "open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars",
    "getattr", "setattr", "delattr", "input", "breakpoint", "exit", "quit", "help",
    "memoryview", "os", "sys", "subprocess", "shutil", "pathlib", "Path", "socket",
    "importlib", "builtins", "ctypes", "pickle", "marshal", "requests", "urllib",
    "http", "tempfile", "glob", "io", "multiprocessing", "threading", "signal",
}

# Attribute names that read/write files or reach into interpreter internals.
FORBIDDEN_ATTRS = {
    # (Scene.remove is legitimate Manim, so "remove" is deliberately not listed.)
    "system", "popen", "spawn", "unlink", "rmdir", "rmtree", "rename",
    "load", "loads", "save", "savez", "savez_compressed", "savetxt", "loadtxt",
    "fromfile", "tofile", "genfromtxt", "memmap", "ctypeslib", "write_text",
    "write_bytes", "read_text", "read_bytes", "environ", "modules",
}


def check_scene_code(code: str) -> List[str]:
    """Return a list of human-readable violations (empty list = acceptable)."""
    try:
        tree = ast.parse(code)
    except SyntaxError:  # let the render/fix loop surface syntax errors
        return []

    problems: List[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] not in ALLOWED_IMPORTS:
                    problems.append(f"line {node.lineno}: import of '{alias.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            mod = (node.module or "").split(".")[0]
            if mod not in ALLOWED_IMPORTS:
                problems.append(f"line {node.lineno}: import from '{node.module}' is not allowed")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            problems.append(f"line {node.lineno}: use of '{node.id}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr in FORBIDDEN_ATTRS:
                problems.append(f"line {node.lineno}: attribute '.{node.attr}' is not allowed")
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            problems.append(f"line {node.lineno}: global/nonlocal statements are not allowed")
    # De-duplicate while preserving order
    seen = set()
    return [p for p in problems if not (p in seen or seen.add(p))]
