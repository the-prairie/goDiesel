import type { Locator } from "@playwright/test";

export async function chooseSelectOption(control: Locator, label: string) {
  await control.click();
  await control
    .page()
    .getByRole("option", { name: label, exact: true })
    .click();
}
