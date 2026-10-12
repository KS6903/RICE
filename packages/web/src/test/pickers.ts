import { expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

// Something with getByLabelText: `screen`, or `within(element)`.
type Scope = Pick<typeof screen, "getByLabelText">;

/**
 * Chooses `option` in the app's dropdown (components/Select) labelled `label`.
 * Waits for the option, so a list that is still loading is fine.
 */
export async function chooseOption(
  label: string | RegExp,
  option: string | RegExp,
  scope: Scope = screen,
) {
  await waitFor(() => {
    if (!screen.queryByRole("listbox")) fireEvent.click(scope.getByLabelText(label));
    expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

/**
 * Picks `iso` ("yyyy-MM-dd") in the app's date field (components/DatePicker)
 * labelled `label`, the way a person would: through the month and year
 * choosers, so it works for any date from the day the picker opens.
 */
export function chooseDate(label: string | RegExp, iso: string, scope: Scope = screen) {
  fireEvent.click(scope.getByLabelText(label));
  const panel = within(screen.getByRole("dialog", { name: "Choose a date" }));
  const [year, month] = iso.split("-");

  if (!document.querySelector(`[data-day="${iso}"]`)) {
    fireEvent.click(panel.getByRole("button", { name: "Choose month and year" }));
    if (!document.querySelector(`[data-month="${year}-${month}"]`)) {
      fireEvent.click(panel.getByRole("button", { name: "Choose year" }));
      for (let page = 0; page < 40 && !document.querySelector(`[data-year="${year}"]`); page++) {
        const back =
          Number(year) < Number(document.querySelector("[data-year]")?.getAttribute("data-year"));
        fireEvent.click(
          panel.getByRole("button", { name: back ? "Previous years" : "Next years" }),
        );
      }
      fireEvent.click(document.querySelector(`[data-year="${year}"]`) as Element);
    }
    fireEvent.click(document.querySelector(`[data-month="${year}-${month}"]`) as Element);
  }
  fireEvent.click(document.querySelector(`[data-day="${iso}"]`) as Element);
}
