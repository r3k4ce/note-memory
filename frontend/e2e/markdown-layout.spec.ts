import { expect, type Page, test } from "@playwright/test";

const category = {
  id: 1,
  name: "Work",
  slug: "work",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

const longBody = Array.from(
  { length: 80 },
  (_, index) => `## Section ${index + 1}\n\nThis is a long paragraph for section ${index + 1}.`,
).join("\n\n");

const note = {
  id: 10,
  original_text: longBody,
  ai_title: "Long workspace note",
  short_summary: "A long note for layout regression coverage.",
  tags: ["layout"],
  date_added: "2026-07-03T00:00:00Z",
  updated_at: "2026-07-04T00:00:00Z",
  category,
};

async function mockApi(page: Page) {
  await page.route("http://localhost:8000/categories", async (route) => {
    await route.fulfill({ json: [category] });
  });
  await page.route("http://localhost:8000/notes", async (route) => {
    await route.fulfill({ json: [note] });
  });
  await page.route("http://localhost:8000/notes/10", async (route) => {
    await route.fulfill({ json: note });
  });
}

async function getMarkdownSurfaceFadeStyles(page: Page) {
  return page.evaluate(() => {
    const pageSurface = document.querySelector(".markdown-page-surface");
    const toolbarOverlay = document.querySelector(".note-toolbar-overlay");
    if (!(pageSurface instanceof HTMLElement) || !(toolbarOverlay instanceof HTMLElement)) {
      throw new Error("Missing markdown surface fade target");
    }

    const before = getComputedStyle(pageSurface, "::before");
    const after = getComputedStyle(pageSurface, "::after");
    const toolbarOverlayStyle = getComputedStyle(toolbarOverlay);

    return {
      after: {
        backgroundColor: after.backgroundColor,
        bottom: after.bottom,
        content: after.content,
        height: after.height,
        maskImage: after.maskImage,
        pointerEvents: after.pointerEvents,
        position: after.position,
        zIndex: Number(after.zIndex),
      },
      before: {
        backgroundColor: before.backgroundColor,
        content: before.content,
        height: before.height,
        maskImage: before.maskImage,
        pointerEvents: before.pointerEvents,
        position: before.position,
        top: before.top,
        zIndex: Number(before.zIndex),
      },
      surfaceBackgroundColor: getComputedStyle(pageSurface).backgroundColor,
      toolbarZIndex: Number(toolbarOverlayStyle.zIndex),
    };
  });
}

function expectMarkdownSurfaceFades(fadeStyles: Awaited<ReturnType<typeof getMarkdownSurfaceFadeStyles>>) {
  for (const fadeStyle of [fadeStyles.before, fadeStyles.after]) {
    expect(fadeStyle.content).not.toBe("none");
    expect(fadeStyle.position).toBe("absolute");
    expect(fadeStyle.pointerEvents).toBe("none");
    expect(fadeStyle.backgroundColor).toBe(fadeStyles.surfaceBackgroundColor);
    expect(fadeStyle.maskImage).toContain("linear-gradient");
    expect(Number.parseFloat(fadeStyle.height)).toBeGreaterThan(0);
    expect(fadeStyle.zIndex).toBeLessThan(fadeStyles.toolbarZIndex);
  }

  expect(fadeStyles.before.top).toBe("0px");
  expect(fadeStyles.before.height).toBe("80px");
  expect(fadeStyles.before.maskImage).toContain("0.8");
  expect(fadeStyles.before.maskImage).toContain("68px");
  expect(fadeStyles.before.maskImage).toContain("0.45");
  expect(fadeStyles.after.bottom).toBe("0px");
  expect(fadeStyles.after.height).toBe("48px");
  expect(fadeStyles.after.maskImage).toContain("to top");
}

test("long markdown documents use the full shared page surface in edit and read mode", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("button", { name: "Long workspace note" }).click();
  await expect(page.getByLabel("Markdown source")).toBeVisible();

  const editGeometry = await page.evaluate(() => {
    const pageSurface = document.querySelector(".markdown-page-surface");
    const scroller = document.querySelector(".markdown-codemirror-workspace .cm-scroller");
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Note toolbar"]');
    const firstLine = document.querySelector(".markdown-codemirror-workspace .cm-line");
    if (
      !(pageSurface instanceof HTMLElement) ||
      !(scroller instanceof HTMLElement) ||
      !(toolbar instanceof HTMLElement) ||
      !(firstLine instanceof HTMLElement)
    ) {
      throw new Error("Missing edit surface");
    }

    const toolbarRect = toolbar.getBoundingClientRect();
    const firstLineRect = firstLine.getBoundingClientRect();

    return {
      firstLineTop: firstLineRect.top,
      pageHeight: pageSurface.getBoundingClientRect().height,
      scrollerHeight: scroller.getBoundingClientRect().height,
      scrollerClientHeight: scroller.clientHeight,
      scrollerScrollHeight: scroller.scrollHeight,
      scrollerMaxHeight: getComputedStyle(scroller).maxHeight,
      toolbarBottom: toolbarRect.bottom,
    };
  });

  expect(editGeometry.pageHeight).toBeGreaterThan(780);
  expect(editGeometry.scrollerHeight).toBeGreaterThan(editGeometry.pageHeight - 8);
  expect(editGeometry.scrollerMaxHeight).toBe("none");
  expect(editGeometry.firstLineTop).toBeGreaterThan(editGeometry.toolbarBottom);
  expect(editGeometry.scrollerScrollHeight).toBeGreaterThan(editGeometry.scrollerClientHeight);
  expectMarkdownSurfaceFades(await getMarkdownSurfaceFadeStyles(page));

  await page.getByRole("button", { name: "Read Mode" }).click();
  await expect(page.getByRole("heading", { name: "Section 1", exact: true })).toBeVisible();

  const readGeometry = await page.evaluate(() => {
    const pageSurface = document.querySelector(".markdown-page-surface");
    const preview = document.querySelector(".note-preview");
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Note toolbar"]');
    const firstHeading = document.querySelector(".note-preview h1, .note-preview h2");
    if (
      !(pageSurface instanceof HTMLElement) ||
      !(preview instanceof HTMLElement) ||
      !(toolbar instanceof HTMLElement) ||
      !(firstHeading instanceof HTMLElement)
    ) {
      throw new Error("Missing read surface");
    }

    const pageRect = pageSurface.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const headingRect = firstHeading.getBoundingClientRect();
    preview.scrollTop = preview.scrollHeight;

    return {
      pageHeight: pageRect.height,
      pageWidth: pageRect.width,
      previewHeight: previewRect.height,
      previewWidth: previewRect.width,
      previewClientHeight: preview.clientHeight,
      previewScrollHeight: preview.scrollHeight,
      headingTop: headingRect.top,
      toolbarBottom: toolbarRect.bottom,
      scrolledText: preview.textContent ?? "",
      text: preview.textContent ?? "",
    };
  });

  expect(readGeometry.pageHeight).toBeGreaterThan(780);
  expect(readGeometry.previewHeight).toBeGreaterThan(readGeometry.pageHeight - 8);
  expect(readGeometry.previewWidth).toBeGreaterThan(readGeometry.pageWidth - 8);
  expect(readGeometry.headingTop).toBeGreaterThan(readGeometry.toolbarBottom);
  expect(readGeometry.previewScrollHeight).toBeGreaterThan(readGeometry.previewClientHeight);
  expect(readGeometry.text).toContain("title: Long workspace note");
  expect(readGeometry.scrolledText).toContain("Section 80");
  expectMarkdownSurfaceFades(await getMarkdownSurfaceFadeStyles(page));
});
