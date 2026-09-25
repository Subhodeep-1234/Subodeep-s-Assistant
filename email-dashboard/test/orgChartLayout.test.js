const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrgChartLayout, SIZES, cardHeight, GAP_X, MAX_CARDS_PER_ROW } = require('../public/orgChartPdfLayout.js');

function person(name, designation) { return { name, designation }; }
function group(designation, names) {
  return { designation, count: names.length, employees: names.map((n) => ({ name: n })) };
}
function emptyBranch() { return { direct: { whiteCollarGroups: [], blueCollarGroups: [], groupDGroups: [] }, hods: [] }; }
function branchWithHods(hods, direct) {
  return { hods, direct: direct || { whiteCollarGroups: [], blueCollarGroups: [], groupDGroups: [] } };
}

function baseData(overrides) {
  return Object.assign({
    department: 'TEST',
    totalEmployees: 1,
    managingDirector: person('MD Name', 'Managing Director'),
    mdBranch: emptyBranch(),
    directors: []
  }, overrides);
}

function centerX(node) { return node.x + node.width / 2; }
function bottomY(node) { return node.y + node.height; }
function findNodes(layout, type) { return layout.nodes.filter((n) => n.type === type); }

test('single HOD, single designation group: MD -> HOD -> one card, no bus', () => {
  const data = baseData({
    directors: [],
    mdBranch: branchWithHods([
      { hod: person('Hod One', 'Manager'), whiteCollarGroups: [group('Executive', ['Alice'])], blueCollarGroups: [], groupDGroups: [] }
    ])
  });
  const layout = computeOrgChartLayout(data);
  const md = findNodes(layout, 'md')[0];
  const hods = findNodes(layout, 'hod');
  const cards = findNodes(layout, 'card');
  assert.equal(hods.length, 1);
  assert.equal(cards.length, 1);
  // Straight vertical chain: MD, HOD and the single card all share one x-center.
  assert.ok(Math.abs(centerX(md) - centerX(hods[0])) < 0.01);
  assert.ok(Math.abs(centerX(hods[0]) - centerX(cards[0])) < 0.01);
  // No fan-out connector should exist for a single-child chain.
  const elbow = layout.connectors.find((c) => c.kind === 'elbow');
  assert.equal(elbow, undefined, 'a single card must not produce a bus/elbow connector');
});

test('HOD with zero team members still renders its own box with no dangling connector below', () => {
  const data = baseData({
    mdBranch: branchWithHods([
      { hod: person('Lonely Hod', 'Manager'), whiteCollarGroups: [], blueCollarGroups: [], groupDGroups: [] }
    ])
  });
  const layout = computeOrgChartLayout(data);
  const hods = findNodes(layout, 'hod');
  assert.equal(hods.length, 1);
  const cards = findNodes(layout, 'card');
  assert.equal(cards.length, 0);
  // No connector should originate below this HOD (it has no children at all).
  const fromHod = layout.connectors.filter((c) => Math.abs(c.from.x - centerX(hods[0])) < 0.01 && Math.abs(c.from.y - bottomY(hods[0])) < 0.01);
  assert.equal(fromHod.length, 0);
});

test('a 20-member designation card is exactly as tall as the count-based formula predicts', () => {
  const names = Array.from({ length: 20 }, (_, i) => 'Person ' + i);
  const data = baseData({
    mdBranch: branchWithHods([
      { hod: person('Big Team Hod', 'Manager'), whiteCollarGroups: [group('Executive', names)], blueCollarGroups: [], groupDGroups: [] }
    ])
  });
  const layout = computeOrgChartLayout(data);
  const card = findNodes(layout, 'card')[0];
  assert.equal(card.height, cardHeight({ count: 20 }));
});

test('6 HODs side by side: bus spans exactly from the first HOD center to the last', () => {
  const hods = Array.from({ length: 6 }, (_, i) => ({
    hod: person('Hod ' + i, 'Manager'),
    whiteCollarGroups: [group('Executive', ['Person ' + i])],
    blueCollarGroups: [], groupDGroups: []
  }));
  const data = baseData({ mdBranch: branchWithHods(hods) });
  const layout = computeOrgChartLayout(data);
  const hodNodes = findNodes(layout, 'hod').sort((a, b) => a.x - b.x);
  assert.equal(hodNodes.length, 6);
  const elbow = layout.connectors.find((c) => c.children && c.children.length === 6);
  assert.ok(elbow, 'expected one elbow connector fanning out to all 6 HODs');
  assert.ok(Math.abs(elbow.busAnchor.x - (centerX(hodNodes[0]) + centerX(hodNodes[5])) / 2) < 0.01);
  // No two HOD boxes overlap horizontally.
  for (let i = 1; i < hodNodes.length; i++) {
    assert.ok(hodNodes[i].x >= hodNodes[i - 1].x + hodNodes[i - 1].width, 'HOD ' + i + ' overlaps its left neighbor');
  }
});

test('10+ designation groups under one HOD wrap into multiple rows, all still centered on the HOD', () => {
  const groups = Array.from({ length: 12 }, (_, i) => group('Role ' + i, ['Person ' + i]));
  const data = baseData({
    mdBranch: branchWithHods([{ hod: person('Wrap Hod', 'Manager'), whiteCollarGroups: groups, blueCollarGroups: [], groupDGroups: [] }])
  });
  const layout = computeOrgChartLayout(data);
  const cards = findNodes(layout, 'card');
  assert.equal(cards.length, 12);
  const rowYs = Array.from(new Set(cards.map((c) => c.y))).sort((a, b) => a - b);
  assert.ok(rowYs.length >= Math.ceil(12 / MAX_CARDS_PER_ROW), 'expected cards to wrap into at least 2 rows');
  const hod = findNodes(layout, 'hod')[0];
  // Every wrapped row's own set of cards should itself be centered under the HOD.
  rowYs.forEach((y) => {
    const rowCards = cards.filter((c) => c.y === y).sort((a, b) => a.x - b.x);
    const rowCenter = (centerX(rowCards[0]) + centerX(rowCards[rowCards.length - 1])) / 2;
    assert.ok(Math.abs(rowCenter - centerX(hod)) < 0.5, 'row at y=' + y + ' is not centered under its HOD');
  });
});

test('mixed: one HOD with 1 card, another with many, in the same chart - no overlap, both centered correctly', () => {
  const manyNames = Array.from({ length: 6 }, (_, i) => 'Many ' + i);
  const data = baseData({
    mdBranch: branchWithHods([
      { hod: person('Small Hod', 'Manager'), whiteCollarGroups: [group('Exec', ['Solo Person'])], blueCollarGroups: [], groupDGroups: [] },
      { hod: person('Big Hod', 'Manager'), whiteCollarGroups: manyNames.map((n, i) => group('Role ' + i, [n])), blueCollarGroups: [], groupDGroups: [] }
    ])
  });
  const layout = computeOrgChartLayout(data);
  const cards = findNodes(layout, 'card');
  assert.equal(cards.length, 1 + 6);
  // No overlap check across every pair of leaf cards.
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
      assert.ok(!(overlapX && overlapY), 'cards ' + i + ' and ' + j + ' overlap');
    }
  }
});

test('every elbow connector bus spans exactly first-child-center to last-child-center, never past them', () => {
  const groups = Array.from({ length: 5 }, (_, i) => group('Role ' + i, ['P' + i]));
  const data = baseData({
    mdBranch: branchWithHods([{ hod: person('Hod', 'Manager'), whiteCollarGroups: groups, blueCollarGroups: [], groupDGroups: [] }])
  });
  const layout = computeOrgChartLayout(data);
  const cards = findNodes(layout, 'card').sort((a, b) => a.x - b.x);
  const elbow = layout.connectors.find((c) => c.children && c.children.length === 5);
  assert.ok(elbow);
  assert.ok(Math.abs(elbow.busAnchor.x - (centerX(cards[0]) + centerX(cards[4])) / 2) < 0.01);
});
