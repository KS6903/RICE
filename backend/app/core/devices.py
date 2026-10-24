"""What a User-Agent says about the device a session signed in from.

For the Devices list in Settings: the kind of device, its name where the browser
gives one (an Android phone's model), the browser and the operating system. A
User-Agent is only what the browser claims, so this is a description to help
someone recognize their own device, never a security decision.
"""

from __future__ import annotations

import re

_WINDOWS = {"10.0": "Windows 10 or 11", "6.3": "Windows 8.1", "6.2": "Windows 8", "6.1": "Windows 7"}

# Most specific first: Edge, Opera and Samsung's browser all say "Chrome" too.
_BROWSERS = (
    (r"Edg(?:e|A|iOS)?/(\d+)", "Edge"),
    (r"OPR/(\d+)", "Opera"),
    (r"SamsungBrowser/(\d+)", "Samsung Internet"),
    (r"(?:Firefox|FxiOS)/(\d+)", "Firefox"),
    (r"(?:CriOS|Chrome)/(\d+)", "Chrome"),
    (r"Version/(\d+)[.\d]* (?:Mobile/\S+ )?Safari/", "Safari"),
)


def describe_device(user_agent: str | None) -> dict[str, str | None]:
    """``device_type`` (Phone, Tablet, Computer, Desktop app or Unknown) and
    ``device_name``, ``browser`` and ``os``, each None when the User-Agent
    doesn't say."""
    ua = user_agent or ""
    if not ua:
        return {"device_type": "Unknown", "device_name": None, "browser": None, "os": None}
    os_name = _os(ua)
    if "Electron" in ua:
        return {"device_type": "Desktop app", "device_name": _computer(ua), "browser": "Oraiza app", "os": os_name}
    return {"device_type": _kind(ua), "device_name": _name(ua), "browser": _browser(ua), "os": os_name}


def _os(ua: str) -> str | None:
    if m := re.search(r"Windows NT ([\d.]+)", ua):
        return _WINDOWS.get(m.group(1), "Windows")
    if m := re.search(r"(iPhone|iPad|iPod).*? OS (\d+)(?:_(\d+))?", ua):
        name = "iPadOS" if m.group(1) == "iPad" else "iOS"
        return f"{name} {m.group(2)}" + (f".{m.group(3)}" if m.group(3) else "")
    if m := re.search(r"Android ([\d.]+)", ua):
        return f"Android {m.group(1)}"
    if "CrOS" in ua:
        return "ChromeOS"
    if "Mac OS X" in ua or "Macintosh" in ua:
        # Browsers freeze the macOS version they report, so don't show one.
        return "macOS"
    if "Linux" in ua:
        return "Linux"
    return None


def _browser(ua: str) -> str | None:
    for pattern, name in _BROWSERS:
        if m := re.search(pattern, ua):
            return f"{name} {m.group(1)}"
    return None


def _kind(ua: str) -> str:
    if "iPad" in ua or "Tablet" in ua or ("Android" in ua and "Mobile" not in ua):
        return "Tablet"
    if "iPhone" in ua or "iPod" in ua or "Mobile" in ua:
        return "Phone"
    if re.search(r"Windows|Macintosh|Mac OS X|CrOS|Linux|X11", ua):
        return "Computer"
    return "Unknown"


def _name(ua: str) -> str | None:
    for device in ("iPhone", "iPad", "iPod"):
        if device in ua:
            return device
    if "Android" in ua:
        # "Android 14; SM-S918B Build/..." or "Android 14; Pixel 8)". Chrome now
        # sends "Android 10; K" in place of the model; that's no name.
        m = re.search(r"Android [\d.]+; ([^;)]+?)(?: Build/[^;)]*)?[;)]", ua)
        model = m.group(1).strip() if m else ""
        return model if model and model != "K" else "Android device"
    return _computer(ua)


def _computer(ua: str) -> str | None:
    if "Windows" in ua:
        return "Windows PC"
    if "Macintosh" in ua or "Mac OS X" in ua:
        return "Mac"
    if "CrOS" in ua:
        return "Chromebook"
    if "Linux" in ua or "X11" in ua:
        return "Linux PC"
    return None
