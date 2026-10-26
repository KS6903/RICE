"""The backend's error messages, for the web app's language files.

    python scripts/i18n/backend_messages.py

writes scripts/i18n/backend-messages.json.

The web app shows a server error's `detail` through t() (services/api.ts), so
each fixed message raised in backend/app can be translated like any UI text.
Messages built at run time (f-strings) can't be, and stay in English.
"""

import ast
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / "backend" / "app"


def text_of(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def messages() -> list[str]:
    found: set[str] = set()
    for path in ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Raise) or not isinstance(node.exc, ast.Call):
                continue
            call = node.exc
            candidates = [*call.args[:1], *(k.value for k in call.keywords if k.arg in ("detail", "message"))]
            for c in candidates:
                text = text_of(c)
                # Words for a person, not a code: "No such task", not "mfa_required".
                if text and " " in text.strip() and any(ch.isalpha() for ch in text):
                    found.add(text)
    return sorted(found)


if __name__ == "__main__":
    found = messages()
    out = pathlib.Path(__file__).with_name("backend-messages.json")
    out.write_text(json.dumps(found, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{out.name}: {len(found)} messages")
