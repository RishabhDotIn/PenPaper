"use client";

import type {
  Arrowhead,
  Element,
  FontFamily,
  Roughness,
  StrokeStyle,
  StrokeWidth,
  TextAlign,
} from "@penpaper/shared";
import type { ReactNode } from "react";

const STROKE_COLORS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#6965db"];
const BACKGROUND_COLORS = [
  "transparent",
  "#ffc9c9",
  "#b2f2bb",
  "#a5d8ff",
  "#ffec99",
  "#d0bfff",
];

const STROKE_WIDTHS: ReadonlyArray<{ value: StrokeWidth; label: string }> = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Bold" },
  { value: 4, label: "Extra bold" },
];

const STROKE_STYLES: ReadonlyArray<{ value: StrokeStyle; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const ROUGHNESS: ReadonlyArray<{ value: Roughness; label: string }> = [
  { value: 0, label: "Architect" },
  { value: 1, label: "Artist" },
  { value: 2, label: "Cartoonist" },
];

const FONT_SIZES = [16, 20, 28, 36];

const FONT_FAMILIES: ReadonlyArray<{ value: FontFamily; label: string }> = [
  { value: "excalifont", label: "Hand-drawn" },
  { value: "nunito", label: "Sans" },
  { value: "mono", label: "Mono" },
];

const ALIGNS: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

const ARROWHEADS: ReadonlyArray<{ value: Arrowhead; label: string }> = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "dot", label: "Dot" },
];

export interface PropertiesPanelProps {
  selection: readonly Element[];
  onPatch: (patch: Partial<Element>) => void;
  onDelete?: () => void;
}

/**
 * Edits are patches, never element copies.
 *
 * A panel that rebuilt an element would have to know every field, and any field
 * it forgot would be silently reset. `Partial<Element>` keeps the panel honest:
 * it can only touch what it actually shows.
 */
export function PropertiesPanel({ selection, onPatch, onDelete }: PropertiesPanelProps) {
  const first = selection[0];

  if (!first) {
    return (
      <div className="pp-panel" data-testid="properties-panel">
        <h2 className="pp-panel-title">Nothing selected</h2>
        <p className="pp-hint">
          Pick a shape to change its colour, thickness, and opacity. Hold Shift while
          dragging on empty canvas to select several.
        </p>
      </div>
    );
  }

  const allText = selection.every((element) => element.type === "text");
  const allArrow = selection.every((element) => element.type === "arrow");

  return (
    <div className="pp-panel" data-testid="properties-panel" aria-label="Element properties">
      <h2 className="pp-panel-title">
        {selection.length === 1 ? `1 ${first.type}` : `${selection.length} elements`}
      </h2>

      <Section label="Stroke">
        <Swatches
          colors={STROKE_COLORS}
          value={first.strokeColor}
          labelFor={(color) => `Stroke ${color}`}
          onPick={(strokeColor) => onPatch({ strokeColor })}
        />
      </Section>

      <Section label="Background">
        <Swatches
          colors={BACKGROUND_COLORS}
          value={first.backgroundColor}
          labelFor={(color) => (color === "transparent" ? "No background" : `Background ${color}`)}
          onPick={(backgroundColor) => onPatch({ backgroundColor })}
        />
      </Section>

      {first.backgroundColor !== "transparent" ? (
        <Section label="Fill">
          <Segmented
            options={[
              { value: "hachure" as const, label: "Hachure" },
              { value: "cross-hatch" as const, label: "Cross" },
              { value: "solid" as const, label: "Solid" },
            ]}
            value={first.fillStyle}
            onPick={(fillStyle) => onPatch({ fillStyle })}
          />
        </Section>
      ) : null}

      <Section label="Stroke width">
        <Segmented
          options={STROKE_WIDTHS}
          value={first.strokeWidth}
          onPick={(strokeWidth) => onPatch({ strokeWidth })}
        />
      </Section>

      <Section label="Stroke style">
        <Segmented
          options={STROKE_STYLES}
          value={first.strokeStyle}
          onPick={(strokeStyle) => onPatch({ strokeStyle })}
        />
      </Section>

      <Section label="Sloppiness">
        <Segmented
          options={ROUGHNESS}
          value={first.roughness}
          onPick={(roughness) => onPatch({ roughness })}
        />
      </Section>

      <div className="pp-section">
        <div className="pp-row">
          <span className="pp-label">Opacity</span>
          <span className="pp-label">{first.opacity}%</span>
        </div>
        <input
          className="pp-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={first.opacity}
          aria-label="Opacity"
          onChange={(event) => onPatch({ opacity: Number(event.target.value) })}
        />
      </div>

      {allText ? (
        <>
          <Section label="Font">
            <select
              className="pp-select"
              aria-label="Font family"
              value={first.fontFamily}
              onChange={(event) => onPatch({ fontFamily: event.target.value as FontFamily })}
            >
              {FONT_FAMILIES.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </Section>

          <Section label="Size">
            <Segmented
              options={FONT_SIZES.map((size) => ({ value: size, label: `${size}` }))}
              value={first.fontSize}
              onPick={(fontSize) => onPatch({ fontSize })}
            />
          </Section>

          <Section label="Align">
            <Segmented
              options={ALIGNS}
              value={first.textAlign}
              onPick={(textAlign) => onPatch({ textAlign })}
            />
          </Section>
        </>
      ) : null}

      {allArrow ? (
        <>
          <Section label="Start">
            <select
              className="pp-select"
              aria-label="Start arrowhead"
              value={first.startArrowhead}
              onChange={(event) => onPatch({ startArrowhead: event.target.value as Arrowhead })}
            >
              {ARROWHEADS.map((head) => (
                <option key={head.value} value={head.value}>
                  {head.label}
                </option>
              ))}
            </select>
          </Section>

          <Section label="End">
            <select
              className="pp-select"
              aria-label="End arrowhead"
              value={first.endArrowhead}
              onChange={(event) => onPatch({ endArrowhead: event.target.value as Arrowhead })}
            >
              {ARROWHEADS.map((head) => (
                <option key={head.value} value={head.value}>
                  {head.label}
                </option>
              ))}
            </select>
          </Section>
        </>
      ) : null}

      {onDelete ? (
        <button type="button" className="pp-danger" onClick={onDelete}>
          Delete
        </button>
      ) : null}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pp-section">
      <span className="pp-label">{label}</span>
      {children}
    </div>
  );
}

interface SwatchesProps {
  colors: readonly string[];
  value: string;
  labelFor: (color: string) => string;
  onPick: (color: string) => void;
}

function Swatches({ colors, value, labelFor, onPick }: SwatchesProps) {
  return (
    <div className="pp-swatches">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={`pp-swatch${color === "transparent" ? " pp-swatch-transparent" : ""}`}
          style={color === "transparent" ? undefined : { background: color }}
          aria-label={labelFor(color)}
          aria-pressed={value === color}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

interface SegmentedProps<T extends string | number> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onPick: (value: T) => void;
}

function Segmented<T extends string | number>({ options, value, onPick }: SegmentedProps<T>) {
  return (
    <div className="pp-segment">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
