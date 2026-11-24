import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { WhiteboardDocument } from '@/shared/types';
import {
  isFullElement,
  prepareScene,
  releaseCrossingArrows,
  routeSkeletonArrows,
  splitElements,
  toSceneFile,
  whiteboardLanguage,
} from '@/modules/artefacts/whiteboard/whiteboardScene';

type Element = Record<string, unknown>;

const full = (fields: Element): Element => ({ version: 1, versionNonce: 7, ...fields });

const scene = (elements: Element[], extra: Partial<WhiteboardDocument> = {}): WhiteboardDocument => ({
  type: 'excalidraw',
  version: 2,
  elements,
  ...extra,
});

/** Fake converters that record what they were given. */
const recorder = (options: { failOn?: string } = {}) => {
  const converted: Element[][] = [];
  const restored: unknown[][] = [];
  return {
    converted,
    restored,
    converters: {
      convert: (skeletons: Element[]) => {
        converted.push(skeletons);
        if (options.failOn && skeletons.some((skeleton) => skeleton.id === options.failOn)) throw new Error('bad skeleton');
        return skeletons.map((skeleton) => ({ ...skeleton, converted: true }));
      },
      restore: (elements: unknown[]) => {
        restored.push(elements);
        return elements as Element[];
      },
    },
  };
};

test('full elements carry their id and version pair; skeletons do not', () => {
  assert.equal(isFullElement(full({ id: 'a', type: 'rectangle' })), true);
  assert.equal(isFullElement({ id: 'a', type: 'rectangle' }), false);
  assert.equal(isFullElement({ type: 'rectangle', version: 1, versionNonce: 2 }), false);

  const { full: kept, skeletons } = splitElements([
    full({ id: 'one', type: 'rectangle' }),
    { id: 'two', type: 'ellipse' },
    full({ id: 'three', type: 'text' }),
  ]);
  assert.deepEqual(kept.map((element) => element.id), ['one', 'three']);
  assert.deepEqual(skeletons.map((element) => element.id), ['two']);
});

test('an arrow joined to two shapes by id is drawn from edge to edge', () => {
  const [, , arrow] = routeSkeletonArrows([
    { id: 'left', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
    { id: 'right', type: 'rectangle', x: 300, y: 0, width: 100, height: 50 },
    { type: 'arrow', start: { id: 'left' }, end: { id: 'right' } },
  ]);
  // Right edge of the left box (100) plus the gap, to the left edge of the right box (300) minus the gap.
  assert.equal(arrow.x, 106);
  assert.equal(arrow.y, 25);
  assert.deepEqual(arrow.points, [[0, 0], [188, 0]]);
  assert.equal(arrow.width, 188);
  assert.equal(arrow.height, 0);
});

test('arrows meet ellipses and diamonds at their outline, and reach shapes already on the board', () => {
  const elements = routeSkeletonArrows([
    full({ id: 'db', type: 'ellipse', x: 0, y: 200, width: 200, height: 100 }),
    { id: 'api', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 },
    { id: 'check', type: 'diamond', x: 400, y: 0, width: 200, height: 100 },
    { type: 'arrow', start: { id: 'api' }, end: { id: 'db' } },
    { type: 'arrow', start: { id: 'api' }, end: { id: 'check' } },
  ]);
  const down = elements[3];
  // Straight down from the bottom of the box (y 100) to the top of the ellipse (y 200).
  assert.equal(down.x, 100);
  assert.equal(down.y, 106);
  assert.deepEqual(down.points, [[0, 0], [0, 88]]);
  const across = elements[4];
  // The diamond's left corner is at x 400.
  assert.equal(across.x, 206);
  assert.deepEqual(across.points, [[0, 0], [188, 0]]);
});

test('arrows with their own points, full arrows and arrows to unknown shapes are left alone', () => {
  const own = { type: 'arrow', x: 5, y: 5, points: [[0, 0], [40, 0]], start: { id: 'a' }, end: { id: 'b' } };
  const saved = full({ id: 'saved', type: 'arrow', x: 1, y: 1, start: { id: 'a' }, end: { id: 'b' } });
  const dangling = { type: 'arrow', x: 9, y: 9, start: { id: 'a' }, end: { id: 'missing' } };
  const shapes = [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', type: 'rectangle', x: 100, y: 0, width: 10, height: 10 },
  ];
  const routed = routeSkeletonArrows([...shapes, own, saved, dangling]);
  assert.equal(routed[2], own);
  assert.equal(routed[3], saved);
  assert.equal(routed[4], dangling);
});

test('an arrow without x and y whose end cannot be found still gets a place to start', () => {
  const [, arrow] = routeSkeletonArrows([
    { id: 'a', type: 'rectangle', x: 10, y: 20, width: 100, height: 40 },
    { type: 'arrow', start: { id: 'a' }, end: { id: 'missing' } },
  ]);
  assert.equal(arrow.x, 110);
  assert.equal(arrow.y, 40);
  const [lonely] = routeSkeletonArrows([{ type: 'arrow', end: { id: 'nowhere' } }]);
  assert.equal(lonely.x, 0);
  assert.equal(lonely.y, 0);
});

test('an arrow leaving a frame is taken out of it with its label, one inside stays', () => {
  const released = releaseCrossingArrows([
    { id: 'web', type: 'rectangle', frameId: 'f1' },
    { id: 'api', type: 'rectangle', frameId: 'f1' },
    { id: 'db', type: 'ellipse', frameId: null },
    { id: 'inside', type: 'arrow', frameId: 'f1', startBinding: { elementId: 'web' }, endBinding: { elementId: 'api' } },
    { id: 'out', type: 'arrow', frameId: 'f1', startBinding: { elementId: 'api' }, endBinding: { elementId: 'db' } },
    { id: 'out-label', type: 'text', frameId: 'f1', containerId: 'out' },
    { id: 'inside-label', type: 'text', frameId: 'f1', containerId: 'inside' },
  ]);
  const frameOf = Object.fromEntries(released.map((element) => [element.id, element.frameId]));
  assert.equal(frameOf.inside, 'f1');
  assert.equal(frameOf['inside-label'], 'f1');
  assert.equal(frameOf.out, null);
  assert.equal(frameOf['out-label'], null);
  assert.equal(frameOf.web, 'f1');
});

test('prepareScene routes skeleton arrows, converts skeletons together and draws them above full elements', () => {
  const { converters, converted, restored } = recorder();
  const prepared = prepareScene(scene([
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
    full({ id: 'saved', type: 'rectangle', x: 300, y: 0, width: 100, height: 50 }),
    { type: 'arrow', start: { id: 'a' }, end: { id: 'saved' } },
  ], { appState: { viewBackgroundColor: '#fdf6e3' }, files: { img: { id: 'img' } } }), converters);

  assert.equal(converted.length, 1, 'all skeletons in one call');
  assert.deepEqual(converted[0].map((element) => element.type), ['rectangle', 'arrow']);
  assert.deepEqual(converted[0][1].points, [[0, 0], [188, 0]], 'routed to the full element too');
  assert.deepEqual((restored[0] as Element[]).map((element) => element.id ?? element.type), ['saved', 'a', 'arrow']);
  assert.equal(prepared.appState.viewBackgroundColor, '#fdf6e3');
  assert.deepEqual(prepared.files, { img: { id: 'img' } });
});

test('one malformed skeleton does not lose the rest of the board', () => {
  const { converters, restored } = recorder({ failOn: 'broken' });
  const prepared = prepareScene(scene([
    { id: 'fine', type: 'rectangle', x: 0, y: 0 },
    { id: 'broken', type: 'rectangle' },
    { id: 'also-fine', type: 'ellipse', x: 0, y: 100 },
  ]), converters);
  assert.deepEqual((restored[0] as Element[]).map((element) => element.id), ['fine', 'also-fine']);
  assert.equal(prepared.appState.viewBackgroundColor, '#ffffff');
  assert.deepEqual(prepared.files, {});
});

test('toSceneFile drops deleted elements and the images no longer on the board', () => {
  const file = toSceneFile(
    [
      { id: 'kept', type: 'image', fileId: 'img-1' },
      { id: 'gone', type: 'image', fileId: 'img-2', isDeleted: true },
      { id: 'box', type: 'rectangle' },
    ],
    {},
    { 'img-1': { id: 'img-1' }, 'img-2': { id: 'img-2' } },
  );
  assert.equal(file.type, 'excalidraw');
  assert.deepEqual(file.elements.map((element) => element.id), ['kept', 'box']);
  assert.deepEqual(Object.keys(file.files ?? {}), ['img-1']);
  assert.deepEqual(file.appState, { viewBackgroundColor: '#ffffff' });
});

test('the whiteboard follows the interface language', () => {
  assert.equal(whiteboardLanguage('zh-TW'), 'zh-TW');
  assert.equal(whiteboardLanguage('zh-HK'), 'zh-TW');
  assert.equal(whiteboardLanguage('zh-CN'), 'zh-CN');
  assert.equal(whiteboardLanguage('en-GB'), 'en');
});
