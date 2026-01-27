import { createSVG } from './svg_utils';

/**
 * Arrow - Renders a dependency arrow between two bars
 *
 * Visual layer only - queries bars for positions.
 */
export default class Arrow {
    /**
     * @param {Gantt} gantt - Reference to the Gantt instance
     * @param {Bar} fromBar - The predecessor bar (dependency)
     * @param {Bar} toBar - The dependent bar
     */
    constructor(gantt, fromBar, toBar) {
        this.gantt = gantt;
        this.from_task = fromBar;
        this.to_task = toBar;

        this.calculatePath();
        this.draw();
    }

    calculatePath() {
        const fromBar = this.from_task;
        const toBar = this.to_task;
        const padding = this.gantt.options.padding;
        const curve = this.gantt.options.arrow_curve;

        // Start point: bottom center of fromBar, adjusted left if needed
        let startX = fromBar.$bar.getX() + fromBar.$bar.getWidth() / 2;
        const startY = fromBar.$bar.getY() + fromBar.$bar.getHeight();

        // Adjust startX if toBar is too close or to the left
        const minStartX = fromBar.$bar.getX() + padding;
        while (toBar.$bar.getX() < startX + padding && startX > minStartX) {
            startX -= 10;
        }
        startX -= 10;

        // End point: left side of toBar (with arrowhead offset)
        const endX = toBar.$bar.getX() - 13;
        const endY = toBar.$bar.getY() + toBar.$bar.getHeight() / 2;

        // Direction: is fromBar below toBar?
        const fromIsBelowTo = fromBar.task._index > toBar.task._index;
        const clockwise = fromIsBelowTo ? 1 : 0;

        if (toBar.$bar.getX() <= fromBar.$bar.getX() + padding) {
            // Complex path: need to go around
            this.path = this.computeComplexPath(
                startX, startY, endX, endY,
                padding, curve, fromIsBelowTo, clockwise, toBar
            );
        } else {
            // Simple path: direct vertical then horizontal
            this.path = this.computeSimplePath(
                startX, startY, endX, endY,
                curve, fromIsBelowTo, clockwise
            );
        }
    }

    computeComplexPath(startX, startY, endX, endY, padding, curve, fromIsBelowTo, clockwise, toBar) {
        let adjustedCurve = curve;
        let down1 = padding / 2 - adjustedCurve;

        if (down1 < 0) {
            down1 = 0;
            adjustedCurve = padding / 2;
        }

        const curveY = fromIsBelowTo ? -adjustedCurve : adjustedCurve;
        const down2 = toBar.$bar.getY() + toBar.$bar.getHeight() / 2 - curveY;
        const left = toBar.$bar.getX() - padding;

        return `
            M ${startX} ${startY}
            v ${down1}
            a ${adjustedCurve} ${adjustedCurve} 0 0 1 ${-adjustedCurve} ${adjustedCurve}
            H ${left}
            a ${adjustedCurve} ${adjustedCurve} 0 0 ${clockwise} ${-adjustedCurve} ${curveY}
            V ${down2}
            a ${adjustedCurve} ${adjustedCurve} 0 0 ${clockwise} ${adjustedCurve} ${curveY}
            L ${endX} ${endY}
            m -5 -5
            l 5 5
            l -5 5`;
    }

    computeSimplePath(startX, startY, endX, endY, curve, fromIsBelowTo, clockwise) {
        let adjustedCurve = curve;

        if (endX < startX + adjustedCurve) {
            adjustedCurve = endX - startX;
        }

        // Offset positions the vertical line endpoint so the arc lands at the right Y
        const offset = fromIsBelowTo ? endY + adjustedCurve : endY - adjustedCurve;

        return `
            M ${startX} ${startY}
            V ${offset}
            a ${adjustedCurve} ${adjustedCurve} 0 0 ${clockwise} ${adjustedCurve} ${adjustedCurve}
            L ${endX} ${endY}
            m -5 -5
            l 5 5
            l -5 5`;
    }

    draw() {
        this.element = createSVG('path', {
            d: this.path,
            'data-from': this.from_task.task.uid,
            'data-to': this.to_task.task.uid,
        });
    }

    update() {
        this.calculatePath();
        this.element.setAttribute('d', this.path);
    }
}