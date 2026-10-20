import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TotpSetup from "./TotpSetup";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const URI = `otpauth://totp/Oraiza:mill1?secret=${SECRET}&issuer=Oraiza`;

describe("TotpSetup", () => {
  it("draws the QR code in the page instead of loading it as an image", () => {
    // The otpauth URI carries the TOTP secret. An <img> pointed at a QR service
    // would hand that secret to a third party, so the code must be inline SVG.
    const { container } = render(<TotpSetup secret={SECRET} otpauthUri={URI} />);
    const qr = screen.getByRole("img", { name: "QR code for your authenticator app" });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr.querySelector("path")).not.toBeNull();
    expect(container.querySelector("img, image")).toBeNull();
  });

  it("shows the key in groups of four for typing it in by hand", () => {
    render(<TotpSetup secret={SECRET} otpauthUri={URI} />);
    expect(screen.getByTestId("totp-key")).toHaveTextContent(
      "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
    );
  });

  it("copies the key without the display spaces", async () => {
    const user = userEvent.setup();
    render(<TotpSetup secret={SECRET} otpauthUri={URI} />);
    await user.click(screen.getByRole("button", { name: "Copy key" }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    expect(await screen.findByRole("button", { name: "Key copied" })).toBeInTheDocument();
  });

  it("links the otpauth URI so a phone can add the account directly", () => {
    render(<TotpSetup secret={SECRET} otpauthUri={URI} />);
    expect(screen.getByRole("link", { name: /open in authenticator app/i })).toHaveAttribute(
      "href",
      URI,
    );
  });
});
