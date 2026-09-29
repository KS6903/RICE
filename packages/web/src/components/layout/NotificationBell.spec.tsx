import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";
import NotificationBell from "./NotificationBell";
import { useAuthStore } from "../../stores/authStore";
import { notificationService } from "../../services/NotificationService";

const tenantUser: User = {
  id: "u1",
  username: "mill1",
  full_name: "Mill Owner",
  role: "owner",
  company_id: "c1",
  notifications_unread: 3,
};

const draw = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.spyOn(notificationService, "list").mockResolvedValue({
      unread: 1,
      items: [
        {
          id: "n1",
          kind: "subscription.expiring",
          title: "Your Enterprise plan ends in 7 days",
          body: null,
          link: "/settings",
          created_at: new Date().toISOString(),
          read: false,
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("shows the unread count from /auth/me", () => {
    useAuthStore.setState({ user: tenantUser });
    draw();
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toHaveTextContent("3");
  });

  it("caps the badge at 9+", () => {
    useAuthStore.setState({ user: { ...tenantUser, notifications_unread: 42 } });
    draw();
    expect(screen.getByTestId("notification-bell")).toHaveTextContent("9+");
  });

  it("loads the list only when opened", async () => {
    useAuthStore.setState({ user: tenantUser });
    draw();
    expect(notificationService.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("notification-bell"));
    expect(await screen.findByText("Your Enterprise plan ends in 7 days")).toBeInTheDocument();
  });

  it("is hidden for platform admins, who have no tenant", () => {
    useAuthStore.setState({ user: { ...tenantUser, company_id: null, is_platform_admin: true } });
    const { container } = draw();
    expect(container).toBeEmptyDOMElement();
  });
});
