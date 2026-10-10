import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TasksPage from "./TasksPage";
import { tasksService, type Task } from "../services/TasksService";
import { notificationService } from "../services/NotificationService";

configure({ asyncUtilTimeout: 5000 });

const task: Task = {
  id: "t1",
  source: "wet_palay",
  title: "Wet palay not drying: PP-1",
  body: "PP-1, 5,000 kg at 22% moisture, waiting 30 hours.",
  link: "/paddy",
  status: "open",
  assignee: { id: "u2", name: "Ena" },
  due_at: "2026-10-10T09:00:00Z",
  overdue: true,
  created_at: "2026-10-09T09:00:00Z",
  acknowledged_at: null,
  resolved_at: null,
  resolved_by: null,
  resolution: null,
};

const draw = (path = "/tasks") =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("TasksPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows my tasks, marks one in hand, and resolves it with a note", async () => {
    vi.spyOn(tasksService, "list").mockResolvedValue({
      tasks: [task],
      manager: false,
      unassigned: 0,
    });
    const ack = vi
      .spyOn(tasksService, "acknowledge")
      .mockResolvedValue({ ...task, status: "acknowledged" });
    const resolve = vi
      .spyOn(tasksService, "resolve")
      .mockResolvedValue({ ...task, status: "resolved" });
    draw();
    const card = await screen.findByRole("article", { name: "Wet palay not drying: PP-1" });
    expect(within(card).getByText("Overdue")).toBeInTheDocument();
    expect(within(card).getByText("Ena")).toBeInTheDocument();
    // Not a manager: no Everyone's tab, no assigning.
    expect(screen.queryByRole("tab", { name: "Everyone's" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Reassign" })).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: /I'm on it/ }));
    await waitFor(() => expect(ack).toHaveBeenCalledWith("t1"));
    fireEvent.click(within(card).getByRole("button", { name: /Mark resolved/ }));
    fireEvent.change(within(card).getByLabelText(/What was done/), {
      target: { value: "Moved to the dryer." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Resolved" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith("t1", "Moved to the dryer."));
  });

  it("lets a manager see everyone's tasks and reassign one", async () => {
    const list = vi
      .spyOn(tasksService, "list")
      .mockResolvedValue({ tasks: [task], manager: true, unassigned: 2 });
    vi.spyOn(tasksService, "people").mockResolvedValue({
      people: [{ id: "u3", name: "Ben", role: "mill_operator" }],
    });
    const assign = vi.spyOn(tasksService, "assign").mockResolvedValue(task);
    draw();
    expect(await screen.findByText(/2 open tasks have nobody on them yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Everyone's" }));
    await waitFor(() => expect(list).toHaveBeenCalledWith("all", false));
    const card = await screen.findByRole("article", { name: "Wet palay not drying: PP-1" });
    fireEvent.click(within(card).getByRole("button", { name: "Reassign" }));
    await within(card).findByRole("option", { name: "Ben" });
    fireEvent.change(within(card).getByLabelText("Give it to"), { target: { value: "u3" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("t1", { assignee_id: "u3" }));
  });

  it("makes an alert from the bell into a task", async () => {
    vi.spyOn(tasksService, "list").mockResolvedValue({ tasks: [], manager: true, unassigned: 0 });
    vi.spyOn(notificationService, "list").mockResolvedValue({
      unread: 0,
      items: [
        {
          id: "n1",
          kind: "automation.due_reminders",
          title: "Collections: 1 overdue invoice",
          body: "INV-1, Aling Nena Store: ₱7,500",
          link: "/sales",
          created_at: "2026-10-10T00:00:00Z",
          read: true,
        },
      ],
    });
    vi.spyOn(tasksService, "people").mockResolvedValue({
      people: [{ id: "u2", name: "Ana Books", role: "accountant" }],
    });
    const create = vi.spyOn(tasksService, "fromNotice").mockResolvedValue(task);
    draw("/tasks?from=n1");
    const form = await screen.findByRole("region", { name: "New task" });
    expect(within(form).getByText("Collections: 1 overdue invoice")).toBeInTheDocument();
    await within(form).findByRole("option", { name: "Ana Books (accountant)" });
    fireEvent.change(within(form).getByLabelText("Who will fix it"), { target: { value: "u2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Make it a task" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ notification_id: "n1", assignee_id: "u2" }),
      ),
    );
  });

  it("teaches where tasks come from when there are none", async () => {
    vi.spyOn(tasksService, "list").mockResolvedValue({ tasks: [], manager: false, unassigned: 0 });
    draw();
    expect(await screen.findByText("Nothing to do.")).toBeInTheDocument();
    expect(screen.getByText(/Make it a task/)).toBeInTheDocument();
  });
});
