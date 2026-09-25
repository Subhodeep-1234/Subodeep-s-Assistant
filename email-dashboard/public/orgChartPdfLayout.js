// Pure, DOM-free org chart layout engine. No positions are ever read back
// from the browser - every node's x/y/width/height and every connector's
// full path is computed here, once, from plain data, using fixed
// per-level widths and a formulaic (count-based, not measured) card
// height. That single set of coordinates is what both the card renderer
// and the SVG connector renderer consume, so they can never disagree with
// each other the way independently-measured DOM elements could.
//
// UMD-style export: usable as a plain <script> global in the browser
// (window.OrgChartLayout) and via require() from Node-based unit tests,
// with no bundler and no changes to how workforce.js itself is loaded.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OrgChartLayout = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Fixed per-level sizes (chart units = CSS px at scale 1) ----
  // Every one of these is a single constant used everywhere that level
  // appears, in every department - there is no per-department or
  // per-node override anywhere in this file.
  const SIZES = {
    MD: { width: 176, height: 62 },
    DIRECTOR: { width: 164, height: 56 },
    HOD: { width: 156, height: 56 },
    PILL: { width: 112, height: 24 },
    CARD: { width: 106 }
  };
  // Card height is computed, not measured: a fixed header band plus a
  // fixed height per employee row, so a 1-person card and a 20-person
  // card both come from the exact same formula.
  const CARD_HEAD_HEIGHT = 30;
  const CARD_ROW_HEIGHT = 15;
  const CARD_BODY_V_PADDING = 6; // total top+bottom padding inside the body

  const GAP_X = 20; // horizontal gap between siblings at any fan-out level
  const GAP_Y = 34; // vertical gap between a box and whatever's directly below it
  const PILL_GAP_Y = 34; // hod-bottom -> pill -> cards-top, split evenly around the pill
  const MAX_CARDS_PER_ROW = 8; // a collar section wider than this wraps into multiple rows (stage d)

  function cardHeight(group) {
    const rows = Math.max(1, group.count || (group.employees ? group.employees.length : 1));
    return CARD_HEAD_HEIGHT + CARD_BODY_V_PADDING + rows * CARD_ROW_HEIGHT;
  }

  // ---- Generic fan-out primitive ----
  // Lays out N independent subtrees side by side, each already reduced to
  // its own {width, height, place(x,y)} descriptor by the caller, centered
  // as a group under centerX at the given y. Returns the total width the
  // whole row needs, plus a busAnchor connectors can hang a single line or
  // elbow off of (the row's own horizontal center at its own top edge).
  function layoutFanOutRow(items, centerX, y) {
    if (items.length === 0) return { width: 0, height: 0, centers: [], busAnchor: { x: centerX, y } };
    const totalWidth = items.reduce((sum, it) => sum + it.width, 0) + GAP_X * (items.length - 1);
    let cursor = centerX - totalWidth / 2;
    const centers = [];
    items.forEach((it) => {
      const itemCenterX = cursor + it.width / 2;
      it.place(itemCenterX, y);
      centers.push({ x: itemCenterX, width: it.width, height: it.height });
      cursor += it.width + GAP_X;
    });
    const firstC = centers[0].x;
    const lastC = centers[centers.length - 1].x;
    const maxHeight = Math.max(...items.map((it) => it.height));
    return {
      width: Math.max(totalWidth, 0),
      height: maxHeight,
      centers,
      // A single item degenerates the bus to a point at that item's own
      // center - positionConnectors below already treats an equal
      // first/last x as "no horizontal segment needed", so this needs no
      // special case of its own.
      busAnchor: { x: (firstC + lastC) / 2, y }
    };
  }

  // ---- Card (leaf) ----
  function layoutCard(group) {
    const width = SIZES.CARD.width;
    const height = cardHeight(group);
    let x = 0, y = 0;
    return {
      width, height,
      place(centerX, topY) { x = centerX - width / 2; y = topY; },
      collect(nodes) { nodes.push({ type: 'card', x, y, width, height, data: group }); },
      topAnchor() { return { x: x + width / 2, y }; }
    };
  }

  // ---- One collar section: a pill label, then a fan-out of its cards ----
  // Wrapping into multiple rows (stage d, MAX_CARDS_PER_ROW) reuses the
  // exact same layoutFanOutRow primitive once per row, stacked with the
  // same GAP_Y, so a wrapped row is connected by the exact same elbow
  // logic as a single-row fan-out - never a special case.
  function layoutCollarSection(label, groups) {
    if (!groups || groups.length === 0) return null;
    const rows = [];
    for (let i = 0; i < groups.length; i += MAX_CARDS_PER_ROW) {
      rows.push(groups.slice(i, i + MAX_CARDS_PER_ROW));
    }
    let x = 0, y = 0;
    let measuredWidth = 0;
    const rowCards = rows.map((rowGroups) => rowGroups.map(layoutCard));
    // Bottom-up: this section's own required width is whatever its
    // widest row of cards needs (rows narrower than that just center
    // under the same shared width).
    rowCards.forEach((cards) => {
      const w = cards.reduce((sum, c) => sum + c.width, 0) + GAP_X * (cards.length - 1);
      measuredWidth = Math.max(measuredWidth, w, SIZES.PILL.width);
    });
    let connectors = [];
    let rowsHeightTotal = 0;
    return {
      width: measuredWidth,
      get height() {
        return PILL_GAP_Y + SIZES.PILL.height + rowsHeightTotal;
      },
      place(centerX, topY) {
        x = centerX; y = topY;
        connectors = [];
        rowsHeightTotal = 0;
        const pillTopY = topY + PILL_GAP_Y / 2;
        // The pill sits ON this stem (drawn on top of it, per the spec),
        // so the segment from the section's own top anchor down through
        // the pill to the first row of cards is ONE continuous straight
        // line, not interrupted at the pill - the pill is a label
        // rendered over a point on this line, never a connector
        // endpoint of its own.
        let prevAnchor = { x: centerX, y: topY };
        let rowY = topY + PILL_GAP_Y + SIZES.PILL.height;
        rowCards.forEach((cards) => {
          const fanOut = layoutFanOutRow(cards, centerX, rowY);
          if (cards.length < 2) {
            connectors.push({ kind: 'straight', from: prevAnchor, to: cards[0].topAnchor() });
          } else {
            connectors.push({ kind: 'elbow', from: prevAnchor, busAnchor: fanOut.busAnchor, children: cards.map((c) => c.topAnchor()) });
          }
          const rowHeight = Math.max(...cards.map((c) => c.height));
          rowY += rowHeight + GAP_Y;
          rowsHeightTotal += rowHeight + GAP_Y;
          prevAnchor = { x: centerX, y: rowY - GAP_Y };
        });
      },
      collect(nodes) {
        nodes.push({ type: 'pill', x: x - SIZES.PILL.width / 2, y: y + PILL_GAP_Y / 2, width: SIZES.PILL.width, height: SIZES.PILL.height, data: { label } });
        rowCards.forEach((cards) => cards.forEach((c) => c.collect(nodes)));
      },
      collectConnectors(out) {
        out.push(...connectors);
      },
      topAnchor() { return { x, y }; }
    };
  }

  // ---- A leader box (Director/HOD), optionally followed by a chain of
  // up to 3 collar sections. A slot with no leader box at all (a "direct
  // report, no HOD of their own" fan-in) just omits the box and starts
  // the chain from its own top anchor directly. ----
  function layoutLeaderChain(box, sections) {
    const realSections = sections.filter(Boolean);
    let x = 0, y = 0;
    const chainWidth = Math.max(box ? box.width : 0, ...realSections.map((s) => s.width), 0);
    let connectors = [];
    return {
      width: chainWidth,
      get height() {
        let h = box ? box.height : 0;
        realSections.forEach((s) => { h += GAP_Y + s.height; });
        return h;
      },
      place(centerX, topY) {
        x = centerX; y = topY;
        connectors = [];
        let cursorY = topY;
        let parentAnchor = null;
        if (box) {
          box.place(centerX, cursorY);
          parentAnchor = box.bottomAnchor();
          cursorY += box.height;
        } else {
          parentAnchor = { x: centerX, y: cursorY };
        }
        realSections.forEach((s) => {
          cursorY += GAP_Y;
          s.place(centerX, cursorY);
          connectors.push({ kind: 'straight', from: parentAnchor, to: s.topAnchor() });
          cursorY += s.height;
          parentAnchor = { x: centerX, y: cursorY };
        });
      },
      collect(nodes) {
        if (box) box.collect(nodes);
        realSections.forEach((s) => s.collect(nodes));
      },
      collectConnectors(out) {
        out.push(...connectors);
        realSections.forEach((s) => s.collectConnectors(out));
      },
      topAnchor() { return box ? box.topAnchor() : { x, y }; },
      bottomAnchor() {
        if (realSections.length === 0) return box ? box.bottomAnchor() : { x, y };
        return { x, y: y + this.height };
      }
    };
  }

  function layoutBox(kind, data, sizeKey) {
    const size = SIZES[sizeKey];
    let x = 0, y = 0;
    return {
      width: size.width,
      height: size.height,
      place(centerX, topY) { x = centerX - size.width / 2; y = topY; },
      collect(nodes) { nodes.push({ type: kind, x, y, width: size.width, height: size.height, data }); },
      topAnchor() { return { x: x + size.width / 2, y }; },
      bottomAnchor() { return { x: x + size.width / 2, y: y + size.height }; }
    };
  }

  function collarSectionsFor(branch) {
    return [
      layoutCollarSection('White Collar', branch.whiteCollarGroups),
      layoutCollarSection('Blue Collar', branch.blueCollarGroups),
      layoutCollarSection('Group D', branch.groupDGroups)
    ];
  }

  // A director/HOD "slot" that fans out into further slots below it
  // (HODs under a director, or a lone chain when there's exactly one).
  function layoutBranchSlot(box, branch) {
    const hodSlots = branch.hods.map((h) => layoutLeaderChain(h.hod ? layoutBox('hod', h.hod, 'HOD') : null, collarSectionsFor(h)));
    const directHasContent = branch.direct.whiteCollarGroups.length > 0 || branch.direct.blueCollarGroups.length > 0 || branch.direct.groupDGroups.length > 0;
    const directSlot = directHasContent ? layoutLeaderChain(null, collarSectionsFor(branch.direct)) : null;
    const fanChildren = hodSlots.concat(directSlot ? [directSlot] : []);

    if (fanChildren.length === 0) {
      // No HODs and no direct content at all under this owner - the box
      // (if any) just sits alone with nothing below it.
      return layoutLeaderChain(box, []);
    }
    if (fanChildren.length === 1 && !directSlot) {
      // Exactly one HOD and nothing else - render as a single chained
      // column (leader box -> that HOD's own box -> its collar
      // sections), not a one-item fan-out, so it never draws a
      // pointless single-branch bus.
      const only = hodSlots[0];
      return {
        width: Math.max(box ? box.width : 0, only.width),
        get height() { return (box ? box.height : 0) + GAP_Y + only.height; },
        place(centerX, topY) {
          let cursorY = topY;
          let parentAnchor;
          if (box) { box.place(centerX, cursorY); parentAnchor = box.bottomAnchor(); cursorY += box.height; }
          else parentAnchor = { x: centerX, y: cursorY };
          cursorY += GAP_Y;
          only.place(centerX, cursorY);
          this._connector = { kind: 'straight', from: parentAnchor, to: only.topAnchor() };
        },
        collect(nodes) { if (box) box.collect(nodes); only.collect(nodes); },
        collectConnectors(out) { out.push(this._connector); only.collectConnectors(out); },
        topAnchor() { return box ? box.topAnchor() : only.topAnchor(); },
        bottomAnchor() { return only.bottomAnchor(); }
      };
    }
    // 2+ fanned children (multiple HODs, and/or a separate direct-report
    // slot alongside them) - a real bus line under the owner's own box.
    let connector = null;
    return {
      width: Math.max(box ? box.width : 0, fanChildren.reduce((s, c) => s + c.width, 0) + GAP_X * (fanChildren.length - 1)),
      get height() {
        return (box ? box.height : 0) + GAP_Y + Math.max(...fanChildren.map((c) => c.height));
      },
      place(centerX, topY) {
        let cursorY = topY;
        let parentAnchor;
        if (box) { box.place(centerX, cursorY); parentAnchor = box.bottomAnchor(); cursorY += box.height; }
        else parentAnchor = { x: centerX, y: cursorY };
        cursorY += GAP_Y;
        const fan = layoutFanOutRow(fanChildren, centerX, cursorY);
        connector = { kind: 'elbow', from: parentAnchor, busAnchor: fan.busAnchor, children: fanChildren.map((c) => c.topAnchor()) };
      },
      collect(nodes) { if (box) box.collect(nodes); fanChildren.forEach((c) => c.collect(nodes)); },
      collectConnectors(out) { out.push(connector); fanChildren.forEach((c) => c.collectConnectors(out)); },
      topAnchor() { return box ? box.topAnchor() : { x: 0, y: 0 }; },
      bottomAnchor() { return { x: 0, y: 0 }; }
    };
  }

  // ---- Whole-department entry point ----
  function computeOrgChartLayout(data) {
    const mdBox = layoutBox('md', data.managingDirector, 'MD');
    const directorSlots = data.directors.map((d) =>
      layoutBranchSlot(layoutBox('director', d.director, 'DIRECTOR'), { direct: d.direct, hods: d.hods })
    );
    const mdOwnHasContent = data.mdBranch.hods.length > 0 ||
      data.mdBranch.direct.whiteCollarGroups.length > 0 ||
      data.mdBranch.direct.blueCollarGroups.length > 0 ||
      data.mdBranch.direct.groupDGroups.length > 0;
    const mdOwnSlot = mdOwnHasContent ? layoutBranchSlot(null, data.mdBranch) : null;
    const topLevelChildren = (mdOwnSlot ? [mdOwnSlot] : []).concat(directorSlots);

    const nodes = [];
    const connectors = [];
    mdBox.place(0, 0);
    nodes.push({ type: 'md', x: -SIZES.MD.width / 2, y: 0, width: SIZES.MD.width, height: SIZES.MD.height, data: data.managingDirector });

    let width = SIZES.MD.width;
    let height = SIZES.MD.height;
    if (topLevelChildren.length > 0) {
      const rowY = SIZES.MD.height + GAP_Y;
      if (topLevelChildren.length === 1) {
        topLevelChildren[0].place(0, rowY);
        connectors.push({ kind: 'straight', from: mdBox.bottomAnchor(), to: topLevelChildren[0].topAnchor() });
      } else {
        const fan = layoutFanOutRow(topLevelChildren, 0, rowY);
        connectors.push({ kind: 'elbow', from: mdBox.bottomAnchor(), busAnchor: fan.busAnchor, children: topLevelChildren.map((c) => c.topAnchor()) });
      }
      topLevelChildren.forEach((c) => { c.collect(nodes); c.collectConnectors(connectors); });
      width = Math.max(width, topLevelChildren.reduce((s, c) => s + c.width, 0) + GAP_X * (topLevelChildren.length - 1));
      height = rowY + Math.max(...topLevelChildren.map((c) => c.height));
    }

    // Re-anchor everything to a top-left (0,0) origin - the recursive
    // layout above is built symmetric around x=0 for simplicity.
    const minX = Math.min(0, ...nodes.map((n) => n.x));
    const shiftX = -minX;
    nodes.forEach((n) => { n.x += shiftX; });
    connectors.forEach((c) => {
      shiftPoint(c.from, shiftX); shiftPoint(c.to, shiftX); shiftPoint(c.busAnchor, shiftX);
      if (c.children) c.children.forEach((p) => shiftPoint(p, shiftX));
    });

    return { width: width, height, nodes, connectors };
  }

  function shiftPoint(p, dx) { if (p) p.x += dx; }

  return {
    SIZES, CARD_HEAD_HEIGHT, CARD_ROW_HEIGHT, CARD_BODY_V_PADDING,
    GAP_X, GAP_Y, PILL_GAP_Y, MAX_CARDS_PER_ROW,
    cardHeight, computeOrgChartLayout
  };
});
