import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useOpenOnArrival } from "./useOpenOnArrival";

function Probe() {
  const [open] = useOpenOnArrival();
  const { search } = useLocation();
  return (
    <p>
      {open ? "open" : "closed"} search=[{search}]
    </p>
  );
}

const at = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/paddy" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );

describe("useOpenOnArrival", () => {
  it("opens the form when the link ends in ?new=1, then drops the flag", async () => {
    at("/paddy?new=1");
    await waitFor(() => expect(screen.getByText("open search=[]")).toBeInTheDocument());
  });

  it("keeps other parameters", async () => {
    at("/paddy?tab=inventory&new=1");
    await waitFor(() =>
      expect(screen.getByText("open search=[?tab=inventory]")).toBeInTheDocument(),
    );
  });

  it("stays closed on a plain visit", () => {
    at("/paddy");
    expect(screen.getByText("closed search=[]")).toBeInTheDocument();
  });
});
