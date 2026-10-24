import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DeviceSessionCard from "./DeviceSessionCard";
import type { DeviceSession } from "../services/AuthService";

const phone: DeviceSession = {
  id: "ce692e10-4da9-4d74-8b79-717c40d79f00",
  client: "Chrome · Android",
  device_type: "Phone",
  device_name: "SM-S918B",
  browser: "Chrome 141",
  os: "Android 14",
  user_agent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) Chrome/141.0.0.0 Mobile Safari/537.36",
  ip_address: "203.177.12.34",
  signed_in_ip: "112.198.4.20",
  signed_in_at: "2026-10-20T08:00:00+08:00",
  last_active: "2026-10-24T10:21:00+08:00",
  expires_at: "2026-10-27T08:00:00+08:00",
  current: false,
  cookies: [
    {
      name: "refresh_token",
      purpose: "Keeps this device signed in.",
      lasts: null,
      expires_at: "2026-10-27T08:00:00+08:00",
      http_only: true,
      secure: true,
      same_site: "Strict",
      path: "/api/auth",
    },
  ],
};

describe("DeviceSessionCard", () => {
  it("says what the device is and where it was used from", () => {
    render(<DeviceSessionCard session={phone} />);
    expect(screen.getByText("SM-S918B")).toBeInTheDocument();
    expect(screen.getByText("Phone · Chrome 141 · Android 14")).toBeInTheDocument();
    expect(screen.getByText(/203\.177\.12\.34/)).toBeInTheDocument();
    expect(screen.getByText(/signed in from 112\.198\.4\.20/)).toBeInTheDocument();
    expect(screen.getByText("ce692e10")).toBeInTheDocument();
  });

  it("opens to show its cookies and the User-Agent it sent", () => {
    render(<DeviceSessionCard session={phone} />);
    const toggle = screen.getByRole("button", { name: /Cookies and details/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("refresh_token")).toBeInTheDocument();
    expect(screen.getByText(/Hidden from the page's scripts · HTTPS only/)).toBeInTheDocument();
    expect(screen.getByText(phone.user_agent!)).toBeInTheDocument();
  });

  it("says the desktop app keeps no browser cookies", () => {
    render(
      <DeviceSessionCard
        session={{ ...phone, device_type: "Desktop app", device_name: "Windows PC", cookies: [] }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cookies and details/ }));
    expect(
      screen.getByText("The desktop app keeps its sign-in itself, not in browser cookies."),
    ).toBeInTheDocument();
  });

  it("revokes another device, but has no Revoke for this one", () => {
    const onRevoke = vi.fn();
    const { rerender } = render(<DeviceSessionCard session={phone} onRevoke={onRevoke} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(onRevoke).toHaveBeenCalledOnce();

    rerender(<DeviceSessionCard session={{ ...phone, current: true }} />);
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("explains a session from before device details were kept", () => {
    render(
      <DeviceSessionCard
        session={{
          ...phone,
          device_type: "Unknown",
          device_name: null,
          browser: null,
          os: null,
          user_agent: null,
          ip_address: null,
          signed_in_ip: null,
        }}
      />,
    );
    expect(screen.getByText("Chrome · Android")).toBeInTheDocument();
    expect(screen.getByText(/signed in before Oraiza kept device details/)).toBeInTheDocument();
  });
});
