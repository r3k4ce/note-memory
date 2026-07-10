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
    const sideFades = document.querySelector(".markdown-page-side-fades");
    const toolbarOverlay = document.querySelector(".note-toolbar-overlay");
    if (
      !(pageSurface instanceof HTMLElement) ||
      !(sideFades instanceof HTMLElement) ||
      !(toolbarOverlay instanceof HTMLElement)
    ) {
      throw new Error("Missing markdown surface fade target");
    }

    const before = getComputedStyle(pageSurface, "::before");
    const after = getComputedStyle(pageSurface, "::after");
    const side = getComputedStyle(sideFades);
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
      side: {
        ariaHidden: sideFades.getAttribute("aria-hidden"),
        backgroundImage: side.backgroundImage,
        backgroundSize: side.backgroundSize,
        display: side.display,
        inset: side.inset,
        pointerEvents: side.pointerEvents,
        position: side.position,
        zIndex: Number(side.zIndex),
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
  expect(fadeStyles.side.ariaHidden).toBe("true");
  expect(fadeStyles.side.display).toBe("block");
  expect(fadeStyles.side.position).toBe("absolute");
  expect(fadeStyles.side.pointerEvents).toBe("none");
  expect(fadeStyles.side.backgroundImage).toContain("linear-gradient");
  expect(fadeStyles.side.backgroundImage).toContain(fadeStyles.surfaceBackgroundColor);
  expect(fadeStyles.side.backgroundSize).toContain("24px 100%");
  expect(fadeStyles.side.zIndex).toBeLessThan(fadeStyles.toolbarZIndex);
}

async function getMarkdownSideFadeDisplay(page: Page) {
  return page.evaluate(() => {
    const sideFades = document.querySelector(".markdown-page-side-fades");
    if (!(sideFades instanceof HTMLElement)) {
      throw new Error("Missing markdown side fades");
    }

    const style = getComputedStyle(sideFades);
    return {
      ariaHidden: sideFades.getAttribute("aria-hidden"),
      display: style.display,
      pointerEvents: style.pointerEvents,
    };
  });
}

async function getResizeGripGeometry(page: Page) {
  return page.evaluate(() => {
    const leftSidebar = document.querySelector('[aria-label="Notes sidebar"]');
    const markdownSurface = document.querySelector(".markdown-page-surface");
    const rightSidebar = document.querySelector('[aria-label="Bun pane"]');
    const leftGrip = document.querySelector('[role="separator"][aria-label="Resize notes sidebar"]');
    const rightGrip = document.querySelector('[role="separator"][aria-label="Resize Bun"]');
    if (
      !(leftSidebar instanceof HTMLElement) ||
      !(markdownSurface instanceof HTMLElement) ||
      !(rightSidebar instanceof HTMLElement) ||
      !(leftGrip instanceof HTMLElement) ||
      !(rightGrip instanceof HTMLElement)
    ) {
      throw new Error("Missing resize grip geometry target");
    }

    const toBounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        centerX: rect.left + rect.width / 2,
      };
    };

    return {
      gaps: {
        left: markdownSurface.getBoundingClientRect().left - leftSidebar.getBoundingClientRect().right,
        right: rightSidebar.getBoundingClientRect().left - markdownSurface.getBoundingClientRect().right,
      },
      leftGrip: toBounds(leftGrip),
      leftSidebar: toBounds(leftSidebar),
      markdownSurface: toBounds(markdownSurface),
      rightGrip: toBounds(rightGrip),
      rightSidebar: toBounds(rightSidebar),
      viewportWidth: window.innerWidth,
    };
  });
}

function expectGripCenterInGap(
  grip: { centerX: number },
  leftBound: number,
  rightBound: number,
) {
  expect(grip.centerX).toBeGreaterThanOrEqual(leftBound - 1);
  expect(grip.centerX).toBeLessThanOrEqual(rightBound + 1);
  expect(Math.abs(grip.centerX - (leftBound + rightBound) / 2)).toBeLessThanOrEqual(1);
}

function expectGapToStayFixed(actualGap: number, expectedGap: number) {
  expect(actualGap).toBeGreaterThan(0);
  expect(Math.abs(actualGap - expectedGap)).toBeLessThanOrEqual(1);
}

async function getPaneWidths(page: Page) {
  return page.evaluate(() => {
    const leftSidebar = document.querySelector('[aria-label="Notes sidebar"]');
    const rightSidebar = document.querySelector('[aria-label="Bun pane"]');
    if (!(leftSidebar instanceof HTMLElement) || !(rightSidebar instanceof HTMLElement)) {
      throw new Error("Missing pane width target");
    }

    return {
      left: leftSidebar.getBoundingClientRect().width,
      right: rightSidebar.getBoundingClientRect().width,
    };
  });
}

async function getFocusWidthGeometry(page: Page) {
  return page.evaluate(() => {
    const centerContent = document.querySelector(".workspace-center-content");
    const markdownSurface = document.querySelector(".markdown-page-surface");
    if (!(centerContent instanceof HTMLElement) || !(markdownSurface instanceof HTMLElement)) {
      throw new Error("Missing focus width geometry target");
    }

    const centerRect = centerContent.getBoundingClientRect();
    const surfaceRect = markdownSurface.getBoundingClientRect();
    return {
      center: {
        left: centerRect.left,
        right: centerRect.right,
        width: centerRect.width,
      },
      documentScrollWidth: document.documentElement.scrollWidth,
      surface: {
        left: surfaceRect.left,
        right: surfaceRect.right,
        width: surfaceRect.width,
      },
      viewportWidth: window.innerWidth,
    };
  });
}

async function dragGripBy(page: Page, label: string, deltaX: number) {
  const grip = page.getByRole("separator", { name: label });
  const box = await grip.boundingBox();
  if (!box) {
    throw new Error(`Missing ${label} grip box`);
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
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

test("desktop resize grips stay in the visual gutters", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("button", { name: "Long workspace note" }).click();
  await expect(page.getByLabel("Markdown source")).toBeVisible();

  const initialGeometry = await getResizeGripGeometry(page);
  expectGripCenterInGap(
    initialGeometry.leftGrip,
    initialGeometry.leftSidebar.right,
    initialGeometry.markdownSurface.left,
  );
  expectGripCenterInGap(
    initialGeometry.rightGrip,
    initialGeometry.markdownSurface.right,
    initialGeometry.rightSidebar.left,
  );
  expect(initialGeometry.gaps.left).toBeGreaterThan(0);
  expect(initialGeometry.gaps.right).toBeGreaterThan(0);

  const initialPageWidth = initialGeometry.markdownSurface.width;

  await page.getByRole("separator", { name: "Resize notes sidebar" }).dragTo(page.locator("body"), {
    force: true,
    targetPosition: { x: 420, y: 450 },
  });
  await page.waitForTimeout(250);

  const leftDraggedGeometry = await getResizeGripGeometry(page);
  expectGapToStayFixed(leftDraggedGeometry.gaps.left, initialGeometry.gaps.left);
  expectGapToStayFixed(leftDraggedGeometry.gaps.right, initialGeometry.gaps.right);
  expect(leftDraggedGeometry.markdownSurface.width).toBeLessThan(initialPageWidth - 20);
  expectGripCenterInGap(
    leftDraggedGeometry.leftGrip,
    leftDraggedGeometry.leftSidebar.right,
    leftDraggedGeometry.markdownSurface.left,
  );
  expectGripCenterInGap(
    leftDraggedGeometry.rightGrip,
    leftDraggedGeometry.markdownSurface.right,
    leftDraggedGeometry.rightSidebar.left,
  );

  await page.getByRole("separator", { name: "Resize Bun" }).dragTo(page.locator("body"), {
    force: true,
    targetPosition: { x: 1080, y: 450 },
  });
  await page.waitForTimeout(250);

  const draggedGeometry = await getResizeGripGeometry(page);
  expectGapToStayFixed(draggedGeometry.gaps.left, initialGeometry.gaps.left);
  expectGapToStayFixed(draggedGeometry.gaps.right, initialGeometry.gaps.right);
  expect(draggedGeometry.markdownSurface.width).toBeGreaterThan(leftDraggedGeometry.markdownSurface.width + 20);
  expectGripCenterInGap(
    draggedGeometry.leftGrip,
    draggedGeometry.leftSidebar.right,
    draggedGeometry.markdownSurface.left,
  );
  expectGripCenterInGap(
    draggedGeometry.rightGrip,
    draggedGeometry.markdownSurface.right,
    draggedGeometry.rightSidebar.left,
  );

  await page.getByRole("button", { name: "Focus Mode" }).click();
  await page.waitForTimeout(250);

  const collapsedGeometry = await getResizeGripGeometry(page);
  expect(collapsedGeometry.leftSidebar.width).toBeLessThanOrEqual(2);
  expect(collapsedGeometry.rightSidebar.width).toBeLessThanOrEqual(2);
  expect(collapsedGeometry.leftGrip.centerX).toBeCloseTo(0, 0);
  expect(collapsedGeometry.rightGrip.centerX).toBeCloseTo(collapsedGeometry.viewportWidth, 0);
});

test("focus mode toggles the customized markdown width in edit and read views", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("button", { name: "Long workspace note" }).click();
  await expect(page.getByLabel("Markdown source")).toBeVisible();

  await dragGripBy(page, "Resize notes sidebar", 80);
  await dragGripBy(page, "Resize Bun", -48);
  const preFocus = await getFocusWidthGeometry(page);

  await page.getByRole("button", { name: "Focus Mode" }).click();
  await page.waitForTimeout(200);
  const expandedEdit = await getFocusWidthGeometry(page);
  expect(expandedEdit.surface.width).toBeGreaterThan(preFocus.surface.width + 100);

  await page.getByRole("button", { name: "Shrink editor" }).click();
  await page.waitForTimeout(200);
  const shrunkEdit = await getFocusWidthGeometry(page);
  expect(shrunkEdit.surface.width).toBeCloseTo(preFocus.surface.width, 0);
  expect(Math.abs((shrunkEdit.surface.left + shrunkEdit.surface.right) / 2 - 720)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Read Mode" }).click();
  await expect(page.getByRole("heading", { name: "Section 1", exact: true })).toBeVisible();
  const shrunkRead = await getFocusWidthGeometry(page);
  expect(shrunkRead.surface.width).toBeCloseTo(preFocus.surface.width, 0);
  expect(Math.abs((shrunkRead.surface.left + shrunkRead.surface.right) / 2 - 720)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Expand editor" }).click();
  await page.waitForTimeout(200);
  const expandedRead = await getFocusWidthGeometry(page);
  expect(expandedRead.surface.width).toBeCloseTo(expandedEdit.surface.width, 0);

  await page.getByRole("button", { name: "Shrink editor" }).click();
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(200);
  const narrow = await getFocusWidthGeometry(page);
  expect(narrow.center.width).toBeLessThanOrEqual(narrow.viewportWidth);
  expect(narrow.surface.right).toBeLessThanOrEqual(narrow.viewportWidth);
  expect(narrow.documentScrollWidth).toBeLessThanOrEqual(narrow.viewportWidth);
});

test("desktop resize grips snap panes to their default widths near the magnet zone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("button", { name: "Long workspace note" }).click();
  await expect(page.getByLabel("Markdown source")).toBeVisible();

  await dragGripBy(page, "Resize notes sidebar", 40);
  expect((await getPaneWidths(page)).left).toBeCloseTo(360, 0);

  await dragGripBy(page, "Resize notes sidebar", -45);
  expect((await getPaneWidths(page)).left).toBeCloseTo(320, 0);

  await dragGripBy(page, "Resize Bun", -40);
  expect((await getPaneWidths(page)).right).toBeCloseTo(392, 0);

  await dragGripBy(page, "Resize Bun", 45);
  expect((await getPaneWidths(page)).right).toBeCloseTo(352, 0);
});

test("pane resize snapping is disabled below the desktop breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await mockApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("button", { name: "Long workspace note" }).click();
  await expect(page.getByLabel("Markdown source")).toBeVisible();

  await dragGripBy(page, "Resize notes sidebar", -14);

  expect((await getPaneWidths(page)).left).toBeCloseTo(306, 0);
});

test("markdown side fades stay disabled on narrow viewports", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await mockApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("button", { name: "Long workspace note" }).click();
  await expect(page.getByLabel("Markdown source")).toBeVisible();

  const sideFades = await getMarkdownSideFadeDisplay(page);
  expect(sideFades.ariaHidden).toBe("true");
  expect(sideFades.pointerEvents).toBe("none");
  expect(sideFades.display).toBe("none");
});
