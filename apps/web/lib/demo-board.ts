import { createElement } from "@penpaper/engine";
import type { Element, ElementType } from "@penpaper/shared";

/**
 * Content for the `/b/demo` board.
 *
 * A whiteboard that opens completely empty is a bad first impression and a
 * worse test surface: it proves none of the text, fill, arrow, or freedraw
 * paths. This scene is laid out inside a 390 × 844 phone viewport so the same
 * content works on every device, and it is written to IndexedDB on first open
 * so it behaves like a normal board after that.
 */
export function createDemoElements(): Element[] {
  const elements: Element[] = [];
  let order = 0;

  const add = (type: ElementType, bounds: { x: number; y: number; width: number; height: number }, patch: Partial<Element>): Element => {
    order += 1;
    const element: Element = {
      ...createElement(type, bounds, `demo-${String(order).padStart(3, "0")}`),
      ...patch,
    };
    elements.push(element);
    return element;
  };

  add(
    "text",
    { x: 44, y: 34, width: 310, height: 62 },
    {
      text: "PenPaper",
      fontSize: 52,
      lineHeight: 1.1,
      fontFamily: "excalifont",
      strokeColor: "#1e1e1e",
    },
  );

  add(
    "text",
    { x: 46, y: 100, width: 310, height: 28 },
    {
      text: "A whiteboard that keeps up with you.",
      fontSize: 17,
      fontFamily: "nunito",
      strokeColor: "#5c5c5c",
    },
  );

  // A hand-drawn underline, so the freedraw pipeline is visible immediately.
  add(
    "freedraw",
    { x: 44, y: 94, width: 312, height: 14 },
    {
      points: [
        [0, 6, 0.4],
        [48, 2, 0.6],
        [96, 7, 0.5],
        [148, 3, 0.7],
        [206, 8, 0.5],
        [262, 4, 0.6],
        [312, 8, 0.4],
      ],
      strokeColor: "#e8590c",
      strokeWidth: 2,
      roughness: 0,
    },
  );

  const boxes = [
    { y: 166, title: "1. Sketch an idea", fill: "#e0dfff", ink: "#6965db" },
    { y: 300, title: "2. Shape the flow", fill: "#ffec99", ink: "#e8590c" },
    { y: 434, title: "3. Pick it up anywhere", fill: "#d3f9d8", ink: "#2f9e44" },
  ];

  boxes.forEach((box, index) => {
    add(
      "rectangle",
      { x: 48, y: box.y, width: 292, height: 78 },
      {
        backgroundColor: box.fill,
        fillStyle: "hachure",
        strokeColor: box.ink,
        strokeWidth: 2,
        roughness: 1,
      },
    );

    add(
      "text",
      { x: 68, y: box.y + 22, width: 252, height: 34 },
      {
        text: box.title,
        fontSize: 20,
        fontFamily: "nunito",
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#1e1e1e",
      },
    );

    if (index < boxes.length - 1) {
      add(
        "arrow",
        { x: 194, y: box.y + 78, width: 0, height: 56 },
        {
          points: [
            [0, 0],
            [0, 56],
          ],
          strokeColor: box.ink,
          strokeWidth: 2,
          roughness: 1,
          endArrowhead: "arrow",
        },
      );
    }
  });

  add(
    "text",
    { x: 48, y: 548, width: 300, height: 58 },
    {
      text: "Use the pen, a finger, or a mouse.\nEverything is saved on this device.",
      fontSize: 15,
      lineHeight: 1.45,
      fontFamily: "nunito",
      strokeColor: "#5c5c5c",
    },
  );

  return elements;
}
