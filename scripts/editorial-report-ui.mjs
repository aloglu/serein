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

function selectLastIndex(items) {
  return Math.max(0, items.length - 1);
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
  const bottomHeight = 3;
  const blockHeight = 3;
  const bodyRows = Math.max(6, rows - topHeight - bottomHeight);
  const visibleBlockCount = Math.max(1, Math.floor(bodyRows / blockHeight));
  const issueCount = (
    report.totals.missingPublication
    + report.totals.missingSource
    + report.scheduleGaps.length
    + report.totals.duplicatePoems
  );
  const currentSection = sections[state.sectionIndex];
  const currentItemIndex = state.itemIndexBySection[state.sectionIndex] || 0;

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
  const rightHeaderText = line(`${currentSection.label} | ${currentSection.items.length} items`, rightContentWidth);
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
    const secondaryText = line(`${section.items.length} items`, leftContentWidth);
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
  lines.push(`${ANSI.gray}${line("j/k or arrows move  h/l or Tab switch panes  g/G top/bottom  1-9 jump section  q quit", cols)}${ANSI.reset}`);

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

export async function runEditorialReportTui(report, { title = "SEREIN EDITORIAL REPORT" } = {}) {
  if (!canRenderEditorialReportTui()) {
    throw new Error("Interactive report view requires a TTY.");
  }

  const sections = createSections(report);
  const state = {
    activePane: "sections",
    sectionIndex: 0,
    sectionScroll: 0,
    itemIndexBySection: sections.map(() => 0),
    itemScrollBySection: sections.map(() => 0)
  };

  let pendingG = false;

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");

  const rerender = () => renderApp(report, sections, state, title);

  const moveSection = (delta) => {
    state.sectionIndex = Math.max(0, Math.min(sections.length - 1, state.sectionIndex + delta));
  };

  const moveItem = (delta) => {
    const items = sections[state.sectionIndex].items;
    const nextIndex = (state.itemIndexBySection[state.sectionIndex] || 0) + delta;
    state.itemIndexBySection[state.sectionIndex] = Math.max(0, Math.min(selectLastIndex(items), nextIndex));
  };

  const jumpToBoundary = (direction) => {
    if (state.activePane === "sections") {
      state.sectionIndex = direction === "top" ? 0 : sections.length - 1;
      return;
    }
    const items = sections[state.sectionIndex].items;
    state.itemIndexBySection[state.sectionIndex] = direction === "top" ? 0 : selectLastIndex(items);
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
      }
    };

    const onResize = () => rerender();

    process.stdin.on("keypress", onKeypress);
    process.stdout.on("resize", onResize);
    rerender();
  });
}
