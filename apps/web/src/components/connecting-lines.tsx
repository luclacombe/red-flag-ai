"use client";

import type { RiskLevel } from "@redflag/shared";
import { useCallback, useEffect, useRef } from "react";

interface ConnectingLinesProps {
  activeClause: number | null;
  leftPanelRef: React.RefObject<HTMLDivElement | null>;
  rightPanelRef: React.RefObject<HTMLDivElement | null>;
  /** The actual scrollable element inside the document panel (overflow-y-auto) */
  docScrollContainer: HTMLDivElement | null;
  clauseRiskLevels: Map<number, RiskLevel>;
}

const RISK_COLORS: Record<string, string> = {
  red: "#DC2626",
  yellow: "#E17100",
  green: "#00A73D",
};

const CORNER_RADIUS = 8;

/**
 * SVG overlay that draws orthogonal (elbow) connecting lines between
 * clause highlights (left panel) and analysis cards (right panel).
 * Uses direct DOM manipulation for lag-free scroll tracking.
 */
export function ConnectingLines({
  activeClause,
  leftPanelRef,
  rightPanelRef,
  docScrollContainer,
  clauseRiskLevels,
}: ConnectingLinesProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  // Store volatile props in refs so computeLine doesn't recreate on prop changes
  const activeClauseRef = useRef(activeClause);
  const clauseRiskLevelsRef = useRef(clauseRiskLevels);

  const computeLine = useCallback(() => {
    const pathEl = pathRef.current;
    if (!pathEl) return;

    const currentClause = activeClauseRef.current;
    if (currentClause === null || !leftPanelRef.current || !rightPanelRef.current) {
      pathEl.style.display = "none";
      return;
    }

    const clauseEl = leftPanelRef.current.querySelector(
      `[data-clause-position="${currentClause}"]`,
    );
    const cardEl = rightPanelRef.current.querySelector(`[data-card-position="${currentClause}"]`);

    if (!clauseEl || !cardEl || !svgRef.current) {
      pathEl.style.display = "none";
      return;
    }

    const svgRect = svgRef.current.getBoundingClientRect();
    const clauseRect = clauseEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();

    const leftPanel = leftPanelRef.current.getBoundingClientRect();
    const rightPanel = rightPanelRef.current.getBoundingClientRect();

    const clauseVisible = clauseRect.bottom > leftPanel.top && clauseRect.top < leftPanel.bottom;
    const cardVisible = cardRect.bottom > rightPanel.top && cardRect.top < rightPanel.bottom;

    if (!clauseVisible && !cardVisible) {
      pathEl.style.display = "none";
      return;
    }

    const clampedClauseY = Math.max(
      leftPanel.top,
      Math.min(leftPanel.bottom, clauseRect.top + clauseRect.height / 2),
    );
    const clampedCardY = Math.max(
      rightPanel.top,
      Math.min(rightPanel.bottom, cardRect.top + cardRect.height / 2),
    );

    const x1 = clauseRect.right - svgRect.left;
    const y1 = clampedClauseY - svgRect.top;
    const x2 = cardRect.left - svgRect.left + 3;
    const y2 = clampedCardY - svgRect.top;

    // Vertical connector in the gap between the two panels
    const midX = (leftPanel.right + rightPanel.left) / 2 - svgRect.left;
    const dy = y2 - y1;

    // Is the element's center scrolled outside its panel?
    const clauseCenterY = clauseRect.top + clauseRect.height / 2;
    const clauseIsClamped = clauseCenterY < leftPanel.top || clauseCenterY > leftPanel.bottom;
    const cardCenterY = cardRect.top + cardRect.height / 2;
    const cardIsClamped = cardCenterY < rightPanel.top || cardCenterY > rightPanel.bottom;

    let path: string;

    if (clauseIsClamped && cardIsClamped) {
      // Both off-screen: vertical line in the gap
      path = `M ${midX} ${y1} L ${midX} ${y2}`;
    } else if (clauseIsClamped) {
      // Clause off-screen: start from gap midpoint → vertical → corner → horizontal to card
      const exitDist = x2 - midX;
      const r = Math.min(CORNER_RADIUS, Math.max(exitDist / 2, 1), Math.abs(dy) / 2);
      if (Math.abs(dy) < 2) {
        path = `M ${midX} ${y1} L ${x2} ${y2}`;
      } else {
        const dirY = dy > 0 ? 1 : -1;
        path = [
          `M ${midX} ${y1}`,
          `L ${midX} ${y2 - r * dirY}`,
          `Q ${midX} ${y2}, ${midX + r} ${y2}`,
          `L ${x2} ${y2}`,
        ].join(" ");
      }
    } else if (cardIsClamped) {
      // Card off-screen: clause → horizontal → corner → vertical to gap midpoint
      const clauseGap = midX - x1;
      const r = Math.min(CORNER_RADIUS, Math.max(clauseGap / 2, 1), Math.abs(dy) / 2);
      if (Math.abs(dy) < 2) {
        path = `M ${x1} ${y1} L ${midX} ${y2}`;
      } else {
        const dirY = dy > 0 ? 1 : -1;
        path = [
          `M ${x1} ${y1}`,
          `L ${midX - r} ${y1}`,
          `Q ${midX} ${y1}, ${midX} ${y1 + r * dirY}`,
          `L ${midX} ${y2}`,
        ].join(" ");
      }
    } else {
      // Both visible: full elbow through gap midpoint
      const clauseGap = midX - x1;
      const exitDist = x2 - midX;
      if (clauseGap < 4 || exitDist < 4 || Math.abs(dy) < 2) {
        path = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        const dirY = dy > 0 ? 1 : -1;
        const r = Math.min(CORNER_RADIUS, clauseGap / 2, exitDist / 2, Math.abs(dy) / 2);
        path = [
          `M ${x1} ${y1}`,
          `L ${midX - r} ${y1}`,
          `Q ${midX} ${y1}, ${midX} ${y1 + r * dirY}`,
          `L ${midX} ${y2 - r * dirY}`,
          `Q ${midX} ${y2}, ${midX + r} ${y2}`,
          `L ${x2} ${y2}`,
        ].join(" ");
      }
    }

    const riskLevel = clauseRiskLevelsRef.current.get(currentClause) ?? "green";
    const color = RISK_COLORS[riskLevel] ?? "#00A73D";

    pathEl.setAttribute("d", path);
    pathEl.setAttribute("stroke", color);
    pathEl.style.display = "";
  }, [leftPanelRef, rightPanelRef]);

  // Sync volatile props into refs and recompute
  useEffect(() => {
    activeClauseRef.current = activeClause;
    computeLine();
  }, [activeClause, computeLine]);

  useEffect(() => {
    clauseRiskLevelsRef.current = clauseRiskLevels;
    computeLine();
  }, [clauseRiskLevels, computeLine]);

  // Scroll, resize, and DOM size listeners
  useEffect(() => {
    computeLine();

    const scrollEl = docScrollContainer;
    const rightEl = rightPanelRef.current;

    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          computeLine();
          ticking = false;
        });
      }
    };

    scrollEl?.addEventListener("scroll", onScroll, { passive: true });
    rightEl?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", computeLine);

    // ResizeObserver catches card height changes (e.g. collapsible expand/collapse)
    let ro: ResizeObserver | undefined;
    if (rightEl) {
      ro = new ResizeObserver(() => {
        computeLine();
      });
      ro.observe(rightEl);
    }

    return () => {
      scrollEl?.removeEventListener("scroll", onScroll);
      rightEl?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", computeLine);
      ro?.disconnect();
    };
  }, [computeLine, docScrollContainer, rightPanelRef]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <path
        ref={pathRef}
        fill="none"
        strokeWidth={3}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        style={{ display: "none" }}
      />
    </svg>
  );
}
