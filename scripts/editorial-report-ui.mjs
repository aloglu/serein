import process from "node:process";
import { emitKeypressEvents } from "node:readline";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  pink: "\x1b[38;2;244;182;194m",
  lemon: "\x1b[38;2;255;250;205m"
};

function padRight(text, width) {
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function truncate(text, width) {
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text;
  }
  if (width === 1) {
    return text.slice(0, 1);
  }
  return `${text.slice(0, width - 1)}…`;
}

function line(text = "", width = 0) {
  return padRight(truncate(String(text), width), width);
}

function divider(width) {
  return "-".repeat(Math.max(0, width));
}

function renderGapItem(item, width) {
  return [
    line(`${item.after} -> ${item.before}`, width),
    line(`${item.missingDays} missing day(s)`, width)
  ];
}

function renderPoemItem(item, width) {
  return [
    line(`${item.title}  ${item.poet}`, width),
    line(`${item.date}  ${item.filepath}`, width)
  ];
}

function renderDuplicateItem(item, width) {
  return [
    line(`${item.title}  ${item.poet}`, width),
    line(`${item.count} entries  ${item.poems.map((poem) => poem.date).join(", ")}`, width)
  ];
}

function poetProximityItems(items) {
  const actionable = items.filter((item) => item.actionable);
  const historical = items.filter((item) => !item.actionable);
  const entries = [];

  if (actionable.length > 0) {
    entries.push({ kind: "group", label: "Actionable", count: actionable.length });
    entries.push(...actionable.map((item) => ({ ...item, kind: "issue" })));
  }

  if (historical.length > 0) {
    entries.push({ kind: "group", label: "Historical", count: historical.length });
    entries.push(...historical.map((item) => ({ ...item, kind: "issue" })));
  }

  return entries;
}

function renderPoetProximityItem(item, width) {
  if (item.kind === "group") {
    return [
      `${ANSI.bold}${line(item.label, width)}${ANSI.reset}`,
      line(`${item.count} item${item.count === 1 ? "" : "s"}`, width)
    ];
  }

  return [
    line(`${item.poet}  ${item.later.title}`, width),
    line(`${item.earlier.date} -> ${item.later.date}  ${item.daysApart} day(s)  ${item.state}${item.actionable ? "  f fix" : ""}`, width)
  ];
}

function renderPoetTallyItem(item, width) {
  return [
    line(item.poet, width),
    line(`${item.totalPoems} total  ${item.publishedPoems} published  ${item.scheduledPoems} scheduled`, width)
  ];
}

function createSections(report) {
  return [
    {
      key: "missing-publication",
      label: "Missing publication",
      description: "Poems missing publication metadata.",
      items: report.missingPublication,
      renderItem: renderPoemItem
    },
    {
      key: "missing-source",
      label: "Missing source",
      description: "Poems missing source metadata.",
      items: report.missingSource,
      renderItem: renderPoemItem
    },
    {
      key: "duplicate-poems",
      label: "Duplicate poems",
      description: "Poems sharing the same normalized title, poet, and body.",
      items: report.duplicatePoems,
      renderItem: renderDuplicateItem
    },
    {
      key: "poet-proximity",
      label: "Poet proximity",
      description: "Same-poet poems scheduled too close together. Select an actionable item and press f to push it forward.",
      items: poetProximityItems(report.poetProximity),
      itemCount: report.poetProximity.length,
      renderItem: renderPoetProximityItem
    },
    {
      key: "gaps",
      label: "Schedule gaps",
      description: "Potential scheduling holes between dated poems.",
      items: report.scheduleGaps,
      renderItem: renderGapItem
    },
    {
      key: "custom-markup",
      label: "Custom markup",
      description: "Poems using custom line-layout markup.",
      items: report.customMarkup,
      renderItem: renderPoemItem
    },
    {
      key: "upcoming",
      label: "Upcoming poems",
      description: "Poems scheduled after the current as-of date.",
      items: report.upcomingPoems,
      renderItem: renderPoemItem
    },
    {
      key: "poets",
      label: "Poets",
      description: "All poets with published and scheduled poem counts.",
      items: report.poetTallies,
      renderItem: renderPoetTallyItem
    }
  ];
}

function ensureVisible(index, scroll, visibleCount) {
  if (visibleCount <= 0) {
    return 0;
  }
  if (index < scroll) {
    return index;
  }
  if (index >= scroll + visibleCount) {
    return index - visibleCount + 1;
  }
  return scroll;
}

function isSelectableItem(item) {
  return item?.kind !== "group";
}

function normalizedSelectableIndex(items, index) {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  const safeIndex = Math.max(0, Math.min(items.length - 1, Number(index) || 0));
  if (isSelectableItem(items[safeIndex])) {
    return safeIndex;
  }

  for (let forward = safeIndex + 1; forward < items.length; forward += 1) {
    if (isSelectableItem(items[forward])) {
      return forward;
    }
  }
  for (let backward = safeIndex - 1; backward >= 0; backward -= 1) {
    if (isSelectableItem(items[backward])) {
      return backward;
    }
  }
  return safeIndex;
}

function boundarySelectableIndex(items, direction) {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  if (direction === "bottom") {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (isSelectableItem(items[index])) {
        return index;
      }
    }
    return Math.max(0, items.length - 1);
  }

  return normalizedSelectableIndex(items, 0);
}

function nextSelectableIndex(items, currentIndex, delta) {
  if (!Array.isArray(items) || items.length === 0 || delta === 0) {
    return 0;
  }

  const step = delta < 0 ? -1 : 1;
  let index = normalizedSelectableIndex(items, currentIndex);
  while (true) {
    const nextIndex = index + step;
    if (nextIndex < 0 || nextIndex >= items.length) {
      return index;
    }
    index = nextIndex;
    if (isSelectableItem(items[index])) {
      return index;
    }
  }
}

function styleSelected(text, color, active) {
  if (active) {
    return `${color}${ANSI.bold}${text}${ANSI.reset}`;
  }
  return `${color}${text}${ANSI.reset}`;
}

function buildScrollbar(totalCount, visibleCount, offsetCount, height, activeColor, isActive) {
  const blank = " ";
  if (!isActive || totalCount <= visibleCount || height < 6) {
    return Array.from({ length: height }, () => blank);
  }

  const maxOffset = Math.max(0, totalCount - visibleCount);
  const thumbSize = Math.max(1, Math.round((visibleCount / totalCount) * height));
  const travel = Math.max(0, height - thumbSize);
  const thumbStart = maxOffset === 0 ? 0 : Math.round((offsetCount / maxOffset) * travel);

  return Array.from({ length: height }, (_, index) => {
    if (index >= thumbStart && index < thumbStart + thumbSize) {
      return `${activeColor}${ANSI.bold}█${ANSI.reset}`;
    }
    return `${ANSI.gray}│${ANSI.reset}`;
  });
}

function writeScreen(lines) {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(lines.join("\n"));
}

function renderApp(report, sections, state, titleText) {
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 32;
  const leftPaneWidth = Math.max(29, Math.min(37, Math.floor(cols * 0.28)));
  const gutter = 1;
  const separatorWidth = 3;
  const rightPaneWidth = Math.max(41, cols - leftPaneWidth - gutter - separatorWidth);
  const leftContentWidth = leftPaneWidth - 1;
  const rightContentWidth = rightPaneWidth - 1;
  const topHeight = 5;
  const bottomHeight = 4;
  const blockHeight = 3;
  const bodyRows = Math.max(6, rows - topHeight - bottomHeight);
  const visibleBlockCount = Math.max(1, Math.floor(bodyRows / blockHeight));
  const issueCount = (
    report.totals.missingPublication
    + report.totals.missingSource
    + report.scheduleGaps.length
    + report.totals.duplicatePoems
    + report.totals.poetProximity
  );
  const currentSection = sections[state.sectionIndex];
  const currentItemIndex = normalizedSelectableIndex(
    currentSection.items,
    state.itemIndexBySection[state.sectionIndex] || 0
  );
  state.itemIndexBySection[state.sectionIndex] = currentItemIndex;

  state.sectionScroll = ensureVisible(state.sectionIndex, state.sectionScroll, visibleBlockCount);
  state.itemScrollBySection[state.sectionIndex] = ensureVisible(
    currentItemIndex,
    state.itemScrollBySection[state.sectionIndex] || 0,
    visibleBlockCount
  );

  const lines = [];
  lines.push(`${ANSI.bold}${line(titleText, cols)}${ANSI.reset}`);
  lines.push(line(`as-of ${report.asOfDate} | poems ${report.totals.poems} | published ${report.totals.publishedPoems} | upcoming ${report.totals.upcomingPoems} | poets ${report.totals.poets} | duplicates ${report.totals.duplicatePoems} | issues ${issueCount}`, cols));
  lines.push(divider(cols));

  const sectionStart = state.sectionScroll;
  const visibleSections = sections.slice(sectionStart, sectionStart + visibleBlockCount);
  const itemStart = state.itemScrollBySection[state.sectionIndex] || 0;
  const visibleItems = currentSection.items.slice(itemStart, itemStart + visibleBlockCount);

  const leftHeaderText = line(`Sections | ${sections.length} groups`, leftContentWidth);
  const currentSectionItemCount = Number.isInteger(currentSection.itemCount) ? currentSection.itemCount : currentSection.items.length;
  const rightHeaderText = line(`${currentSection.label} | ${currentSectionItemCount} items`, rightContentWidth);
  const leftHeader = state.activePane === "sections"
    ? `${ANSI.cyan}${ANSI.bold}${leftHeaderText}${ANSI.reset}`
    : `${ANSI.bold}${leftHeaderText}${ANSI.reset}`;
  const rightHeader = state.activePane === "items"
    ? `${ANSI.cyan}${ANSI.bold}${rightHeaderText}${ANSI.reset}`
    : `${ANSI.bold}${rightHeaderText}${ANSI.reset}`;
  const separator = `${ANSI.gray} │ ${ANSI.reset}`;
  lines.push(`${leftHeader} ${" ".repeat(gutter)}${separator}${rightHeader} `);
  lines.push(`${ANSI.gray}${"-".repeat(leftPaneWidth)}${ANSI.reset}${" ".repeat(gutter)}${separator}${ANSI.gray}${"-".repeat(rightPaneWidth)}${ANSI.reset}`);

  const leftLines = [];
  visibleSections.forEach((section, offset) => {
    const absoluteSectionIndex = sectionStart + offset;
    const selected = absoluteSectionIndex === state.sectionIndex;
    const primaryText = line(`${absoluteSectionIndex + 1}. ${section.label}`, leftContentWidth);
    const sectionItemCount = Number.isInteger(section.itemCount) ? section.itemCount : section.items.length;
    const secondaryText = line(`${sectionItemCount} items`, leftContentWidth);
    leftLines.push(selected ? styleSelected(primaryText, ANSI.pink, state.activePane === "sections") : primaryText);
    leftLines.push(selected ? styleSelected(secondaryText, ANSI.pink, state.activePane === "sections") : `${ANSI.gray}${secondaryText}${ANSI.reset}`);
    leftLines.push(line("", leftContentWidth));
  });
  while (leftLines.length < bodyRows) {
    leftLines.push(line("", leftContentWidth));
  }

  const rightLines = [];
  visibleItems.forEach((item, offset) => {
    const absoluteIndex = itemStart + offset;
    const selected = absoluteIndex === currentItemIndex;
    const [primary, secondary] = currentSection.renderItem(item, rightContentWidth);
    rightLines.push(selected ? styleSelected(primary, ANSI.lemon, state.activePane === "items") : primary);
    rightLines.push(selected ? styleSelected(secondary, ANSI.lemon, state.activePane === "items") : `${ANSI.gray}${secondary}${ANSI.reset}`);
    rightLines.push(line("", rightContentWidth));
  });
  while (rightLines.length < bodyRows) {
    rightLines.push(line("", rightContentWidth));
  }

  const leftScrollbar = buildScrollbar(
    sections.length,
    visibleBlockCount,
    sectionStart,
    bodyRows,
    ANSI.pink,
    state.activePane === "sections"
  );
  const rightScrollbar = buildScrollbar(
    currentSection.items.length,
    visibleBlockCount,
    itemStart,
    bodyRows,
    ANSI.lemon,
    state.activePane === "items"
  );

  for (let row = 0; row < bodyRows; row += 1) {
    const leftText = leftLines[row] || "";
    const rightText = rightLines[row] || "";
    const leftTrack = leftScrollbar[row] || " ";
    const rightTrack = rightScrollbar[row] || " ";
    lines.push(`${leftText}${leftTrack}${" ".repeat(gutter)}${separator}${rightText}${rightTrack}`);
  }

  lines.push(divider(cols));
  lines.push(line(currentSection.description, cols));
  lines.push(state.statusMessage
    ? `${ANSI.gray}${line(state.statusMessage, cols)}${ANSI.reset}`
    : line("", cols));
  lines.push(`${ANSI.gray}${line(state.canApplyFix ? "j/k or arrows move  h/l or Tab switch panes  g/G top/bottom  1-9 jump section  f fix proximity  q quit" : "j/k or arrows move  h/l or Tab switch panes  g/G top/bottom  1-9 jump section  q quit", cols)}${ANSI.reset}`);

  writeScreen(lines.slice(0, rows));
}

function cleanup() {
  process.stdout.write("\x1b[?25h\x1b[?1049l");
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}

export function canRenderEditorialReportTui() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function runEditorialReportTui(initialReport, { title = "SEREIN EDITORIAL REPORT", onApplyPoetProximityFix = null } = {}) {
  if (!canRenderEditorialReportTui()) {
    throw new Error("Interactive report view requires a TTY.");
  }

  let report = initialReport;
  let sections = createSections(report);
  const state = {
    activePane: "sections",
    sectionIndex: 0,
    sectionScroll: 0,
    itemIndexBySection: sections.map((section) => normalizedSelectableIndex(section.items, 0)),
    itemScrollBySection: sections.map(() => 0),
    statusMessage: "",
    busy: false,
    canApplyFix: Boolean(onApplyPoetProximityFix)
  };

  let pendingG = false;

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");

  const rerender = () => renderApp(report, sections, state, title);
  const currentItem = () => {
    const items = sections[state.sectionIndex]?.items || [];
    return items[state.itemIndexBySection[state.sectionIndex] || 0] || null;
  };
  const reloadReport = (nextReport) => {
    report = nextReport;
    sections = createSections(report);
    state.sectionIndex = Math.max(0, Math.min(sections.length - 1, state.sectionIndex));
    while (state.itemIndexBySection.length < sections.length) {
      state.itemIndexBySection.push(0);
      state.itemScrollBySection.push(0);
    }
    state.itemIndexBySection.length = sections.length;
    state.itemScrollBySection.length = sections.length;
    const items = sections[state.sectionIndex]?.items || [];
    state.itemIndexBySection[state.sectionIndex] = normalizedSelectableIndex(items, state.itemIndexBySection[state.sectionIndex] || 0);
  };

  const moveSection = (delta) => {
    state.sectionIndex = Math.max(0, Math.min(sections.length - 1, state.sectionIndex + delta));
    state.itemIndexBySection[state.sectionIndex] = normalizedSelectableIndex(
      sections[state.sectionIndex].items,
      state.itemIndexBySection[state.sectionIndex] || 0
    );
  };

  const moveItem = (delta) => {
    const items = sections[state.sectionIndex].items;
    state.itemIndexBySection[state.sectionIndex] = nextSelectableIndex(
      items,
      state.itemIndexBySection[state.sectionIndex] || 0,
      delta
    );
  };

  const jumpToBoundary = (direction) => {
    if (state.activePane === "sections") {
      state.sectionIndex = direction === "top" ? 0 : sections.length - 1;
      state.itemIndexBySection[state.sectionIndex] = normalizedSelectableIndex(
        sections[state.sectionIndex].items,
        state.itemIndexBySection[state.sectionIndex] || 0
      );
      return;
    }
    const items = sections[state.sectionIndex].items;
    state.itemIndexBySection[state.sectionIndex] = boundarySelectableIndex(items, direction);
  };

  await new Promise((resolve) => {
    const stop = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdout.off("resize", onResize);
      cleanup();
      resolve();
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        stop();
        return;
      }

      if (state.busy) {
        if (str === "q") {
          stop();
        }
        return;
      }

      if (key.name !== "g") {
        pendingG = false;
      }

      if (str === "q") {
        stop();
        return;
      }

      if (str >= "1" && str <= "9") {
        const index = Number(str) - 1;
        if (index < sections.length) {
          state.sectionIndex = index;
          state.activePane = "sections";
          state.itemIndexBySection[state.sectionIndex] = normalizedSelectableIndex(
            sections[state.sectionIndex].items,
            state.itemIndexBySection[state.sectionIndex] || 0
          );
          rerender();
        }
        return;
      }

      if (key.name === "tab") {
        state.activePane = state.activePane === "sections" ? "items" : "sections";
        rerender();
        return;
      }

      if (str === "h" || key.name === "left") {
        state.activePane = "sections";
        rerender();
        return;
      }

      if (str === "l" || key.name === "right" || key.name === "return") {
        state.activePane = "items";
        rerender();
        return;
      }

      if (key.name === "up" || str === "k") {
        if (state.activePane === "sections") {
          moveSection(-1);
        } else {
          moveItem(-1);
        }
        rerender();
        return;
      }

      if (key.name === "down" || str === "j") {
        if (state.activePane === "sections") {
          moveSection(1);
        } else {
          moveItem(1);
        }
        rerender();
        return;
      }

      if (str === "g") {
        if (pendingG) {
          jumpToBoundary("top");
          pendingG = false;
          rerender();
          return;
        }
        pendingG = true;
        return;
      }

      if (str === "G") {
        jumpToBoundary("bottom");
        rerender();
        return;
      }

      if (str === "f") {
        const section = sections[state.sectionIndex];
        const item = currentItem();
        if (state.activePane === "items" && section?.key === "poet-proximity" && item && !item.actionable) {
          state.statusMessage = "Historical issue; published poems cannot be moved.";
          rerender();
          return;
        }
        if (
          state.activePane !== "items"
          || section?.key !== "poet-proximity"
          || !item?.actionable
          || !onApplyPoetProximityFix
        ) {
          state.statusMessage = "Select an actionable poet proximity issue in the items pane to apply a fix.";
          rerender();
          return;
        }

        state.busy = true;
        state.statusMessage = `Applying fix for ${item.later.title}...`;
        rerender();
        Promise.resolve(onApplyPoetProximityFix(item))
          .then((result) => {
            if (result?.report) {
              reloadReport(result.report);
            }
            state.statusMessage = result?.message || `Applied fix for ${item.later.title}.`;
          })
          .catch((error) => {
            state.statusMessage = error?.message || String(error);
          })
          .finally(() => {
            state.busy = false;
            rerender();
          });
      }
    };

    const onResize = () => rerender();

    process.stdin.on("keypress", onKeypress);
    process.stdout.on("resize", onResize);
    rerender();
  });
}
