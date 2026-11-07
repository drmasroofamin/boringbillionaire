// Run against the demo servers. Each role uses an isolated browser context.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  const errors = [];
  const contexts = [];
  async function role(name) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.APP_URL || "http://127.0.0.1:5173");
    await page
      .locator(".demo-buttons")
      .getByRole("button", { name, exact: true })
      .click();
    await page.locator(".main-shell").waitFor();
    return page;
  }
  try {
    const donor = await role("Billionaire");
    await donor.getByText("LIVE", { exact: true }).waitFor();
    await donor
      .locator(".category-tabs")
      .getByRole("button", { name: "Electricity", exact: true })
      .click();
    assert.equal(await donor.locator(".bill-card").count(), 1);
    await donor
      .locator(".category-tabs")
      .getByRole("button", { name: /All bills/ })
      .click();
    await donor
      .locator(".bill-card")
      .first()
      .getByRole("button", { name: "Make their day" })
      .click();
    await donor.getByLabel("Your contribution (₹)").fill("100");
    await donor.getByRole("button", { name: /Confirm demo payment/ }).click();
    await donor.getByText("YOU MADE SOMEONE’S DAY").waitFor();
    await donor.getByRole("button", { name: "Keep the good going" }).click();
    await donor
      .getByRole("button", { name: "Top up wallet", exact: true })
      .click();
    await donor.getByLabel("Top-up amount (₹)").fill("500");
    await donor.getByRole("button", { name: /Add .* in demo funds/ }).click();
    await donor.locator(".toast").filter({ hasText: "topped up" }).waitFor();
    const member = await role("General user");
    await member
      .getByRole("button", { name: "My profile", exact: true })
      .click();
    await member
      .getByRole("heading", { name: "Payoneer account", exact: true })
      .waitFor();
    assert.equal(await member.getByText(/Paytm/).count(), 0);
    await member
      .getByRole("button", { name: "My dashboard", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Upload a bill", exact: true })
      .click();
    const suffix = Date.now();
    const title = `A fresh start ${suffix}`;
    await member.getByLabel("A short title").fill(title);
    await member.getByLabel("Bill type").selectOption("medical");
    await member.getByLabel("Amount (₹)", { exact: true }).fill("750");
    await member.getByLabel("Due date", { exact: true }).fill("2027-01-15");
    await member
      .getByLabel("Biller name")
      .fill(`Test Community Clinic ${suffix}`);
    await member.getByLabel("Location", { exact: true }).fill("Mumbai");
    await member
      .getByLabel("Your story")
      .fill("A family is looking for a little help with their medical bill.");
    await member.locator("input[type=file]").setInputFiles({
      name: "bill.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4\nUnique browser test ${suffix}\n%%EOF`),
    });
    await member.getByRole("button", { name: "Submit for review" }).click();
    await member
      .locator(".toast")
      .filter({ hasText: "submitted for review" })
      .waitFor();
    const admin = await role("Admin");
    await admin
      .getByRole("button", { name: "Payment readiness", exact: true })
      .click();
    await admin
      .getByRole("heading", {
        name: "Before the first real rupee.",
        exact: true,
      })
      .waitFor();
    await admin
      .getByRole("button", { name: "Review bills", exact: true })
      .click();
    await admin.getByRole("button", { name: title, exact: true }).click();
    await admin.getByRole("button", { name: "Approve & publish" }).click();
    await admin.locator(".toast").filter({ hasText: "now live" }).waitFor();
    await donor
      .getByRole("button", { name: title, exact: true })
      .waitFor({ timeout: 10000 });
    assert.ok(
      (await donor.locator(".new-bill").count()) > 0,
      "Live bill animates without refresh",
    );
    await donor.screenshot({ path: "/tmp/boring-desktop.png", fullPage: true });
    await donor.setViewportSize({ width: 390, height: 844 });
    await donor.waitForTimeout(350);
    assert.equal(
      await donor.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "No mobile overflow",
    );
    await donor.screenshot({
      path: "/tmp/boring-mobile-feed.png",
      fullPage: true,
    });
    const sidebar = await donor.locator(".sidebar").boundingBox();
    assert.ok(sidebar.x + sidebar.width <= 1, "Navigation is hidden on mobile");
    await donor.getByRole("button", { name: "Open navigation" }).click();
    await donor
      .locator(".sidebar")
      .getByRole("button", { name: "My wallet", exact: true })
      .click();
    await donor
      .getByRole("heading", { name: "A wallet with a purpose." })
      .waitFor();
    await donor.waitForTimeout(350);
    await donor.screenshot({
      path: process.env.MOBILE_SCREENSHOT || "/tmp/boring-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log(
      "PASS: login, category filter, partial funding, top-up, upload, review, real-time feed, new-bill animation, mobile navigation and layout.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
