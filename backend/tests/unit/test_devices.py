"""What the Devices list makes of a User-Agent."""

import pytest

from app.core.devices import describe_device

CASES = [
    (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
        ("Computer", "Windows PC", "Edge 141", "Windows 10 or 11"),
    ),
    (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/18.1 Mobile/15E148 Safari/604.1",
        ("Phone", "iPhone", "Safari 18", "iOS 18.1"),
    ),
    (
        "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) "
        "SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
        ("Phone", "SM-S918B", "Samsung Internet 26", "Android 14"),
    ),
    (
        # Chrome's reduced User-Agent puts "K" where the model was.
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/141.0.0.0 Mobile Safari/537.36",
        ("Phone", "Android device", "Chrome 141", "Android 10"),
    ),
    (
        "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/141.0.0.0 Safari/537.36",
        ("Tablet", "SM-X710", "Chrome 141", "Android 13"),
    ),
    (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/18.1 Safari/605.1.15",
        ("Computer", "Mac", "Safari 18", "macOS"),
    ),
    (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/138.0 Electron/44.9.1 Safari/537.36",
        ("Desktop app", "Windows PC", "Oraiza app", "Windows 10 or 11"),
    ),
    (None, ("Unknown", None, None, None)),
]


@pytest.mark.parametrize(("user_agent", "expected"), CASES)
def test_describe_device(user_agent, expected):
    d = describe_device(user_agent)
    assert (d["device_type"], d["device_name"], d["browser"], d["os"]) == expected
