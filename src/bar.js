import { $, createSVG, animateSVG } from './svg_utils';

/**
 * Bar - Visual representation of a task in the Gantt chart
 *
 * Pure visual layer - all positioning via Viewport, no temporal arithmetic.
 * Bar never modifies task data directly; fires callbacks for Gantt to handle.
 */
export default class Bar {
    /**
     * @param {Gantt} gantt - Reference to the Gantt instance
     * @param {Task} task - The task this bar represents
     */
    constructor(gantt, task) {
        this.gantt = gantt;
        this.task = task;
        this.arrows = [];
        this.action_completed = false;

        this.prepareHelpers();
        this.prepareWrappers();
        this.refresh();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────

    prepareHelpers() {
        // SVG element utility methods (attached once to prototype)
        if (!SVGElement.prototype.getX) {
            SVGElement.prototype.getX = function () {
                return +this.getAttribute('x');
            };
            SVGElement.prototype.getY = function () {
                return +this.getAttribute('y');
            };
            SVGElement.prototype.getWidth = function () {
                return +this.getAttribute('width');
            };
            SVGElement.prototype.getHeight = function () {
                return +this.getAttribute('height');
            };
            SVGElement.prototype.getEndX = function () {
                return this.getX() + this.getWidth();
            };
        }
    }

    prepareWrappers() {
        this.group = createSVG('g', {
            class: 'bar-wrapper' + (this.task.custom_class ? ' ' + this.task.custom_class : ''),
            'data-id': this.task.uid,
        });
        this.bar_group = createSVG('g', {
            class: 'bar-group',
            append_to: this.group,
        });
        this.handle_group = createSVG('g', {
            class: 'handle-group',
            append_to: this.group,
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────────────────────────────────────

    refresh() {
        this.bar_group.innerHTML = '';
        this.handle_group.innerHTML = '';

        if (this.task.custom_class) {
            this.group.classList.add(this.task.custom_class);
        } else {
            this.group.classList = ['bar-wrapper'];
        }

        this.draw();
        this.bind();
    }

    draw() {
        this.drawBar();
        this.drawProgressBar();
        this.drawLabel();
        this.drawResizeHandles();

        if (this.task.thumbnail) {
            this.drawThumbnail();
        }
    }

    drawBar() {
        const x = this.getX();
        const y = this.getY();
        const width = this.getWidth();
        const height = this.getHeight();
        const cornerRadius = this.gantt.options.bar_corner_radius;

        this.$bar = createSVG('rect', {
            x,
            y,
            width,
            height,
            rx: cornerRadius,
            ry: cornerRadius,
            class: 'bar',
            append_to: this.bar_group,
        });

        if (this.task.color) {
            this.$bar.style.fill = this.task.color;
        }

        if (this.task.invalid) {
            this.$bar.classList.add('bar-invalid');
        }

        animateSVG(this.$bar, 'width', 0, width);
    }

    drawProgressBar() {
        if (this.task.invalid) return;

        const x = this.getX();
        const y = this.getY();
        const height = this.getHeight();
        const cornerRadius = this.gantt.options.bar_corner_radius;
        const progressWidth = this.getProgressWidth();

        // Safari needs different corner radius
        let r = cornerRadius;
        if (!/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
            r = cornerRadius + 2;
        }

        this.$bar_progress = createSVG('rect', {
            x,
            y,
            width: progressWidth,
            height,
            rx: r,
            ry: r,
            class: 'bar-progress',
            append_to: this.bar_group,
        });

        if (this.task.color_progress) {
            this.$bar_progress.style.fill = this.task.color_progress;
        }

        // Date highlight element in header
        this.$date_highlight = this.gantt.chart.createElement({
            classes: `date-range-highlight hide highlight-${this.task.uid}`,
            width: this.getWidth(),
            left: this.getX(),
        });
        this.gantt.$lower_header.prepend(this.$date_highlight);

        animateSVG(this.$bar_progress, 'width', 0, progressWidth);
    }

    drawLabel() {
        const x = this.getX();
        const y = this.getY();
        const width = this.getWidth();
        const height = this.getHeight();
        const imageSize = height - 5;

        let labelX = x + width / 2;
        if (this.task.thumbnail) {
            labelX = x + imageSize + 5;
        }

        createSVG('text', {
            x: labelX,
            y: y + height / 2,
            innerHTML: this.task.name,
            class: 'bar-label',
            append_to: this.bar_group,
        });

        // Labels get BBox in the next tick
        requestAnimationFrame(() => this.updateLabelPosition());
    }

    drawThumbnail() {
        const x = this.getX();
        const y = this.getY();
        const height = this.getHeight();
        const imageSize = height - 5;
        const xOffset = 10;
        const yOffset = 2;

        const defs = createSVG('defs', {
            append_to: this.bar_group,
        });

        createSVG('rect', {
            id: 'rect_' + this.task.uid,
            x: x + xOffset,
            y: y + yOffset,
            width: imageSize,
            height: imageSize,
            rx: '15',
            class: 'img_mask',
            append_to: defs,
        });

        const clipPath = createSVG('clipPath', {
            id: 'clip_' + this.task.uid,
            append_to: defs,
        });

        createSVG('use', {
            href: '#rect_' + this.task.uid,
            append_to: clipPath,
        });

        createSVG('image', {
            x: x + xOffset,
            y: y + yOffset,
            width: imageSize,
            height: imageSize,
            class: 'bar-img',
            href: this.task.thumbnail,
            clipPath: 'clip_' + this.task.uid,
            append_to: this.bar_group,
        });
    }

    drawResizeHandles() {
        if (this.task.invalid || this.gantt.options.readonly) return;

        const handleWidth = 3;
        const height = this.getHeight();
        this.handles = [];

        if (!this.gantt.options.readonly_dates) {
            // Right handle
            this.handles.push(
                createSVG('rect', {
                    x: this.$bar.getEndX() - handleWidth / 2,
                    y: this.$bar.getY() + height / 4,
                    width: handleWidth,
                    height: height / 2,
                    rx: 2,
                    ry: 2,
                    class: 'handle right',
                    append_to: this.handle_group,
                }),
            );

            // Left handle
            this.handles.push(
                createSVG('rect', {
                    x: this.$bar.getX() - handleWidth / 2,
                    y: this.$bar.getY() + height / 4,
                    width: handleWidth,
                    height: height / 2,
                    rx: 2,
                    ry: 2,
                    class: 'handle left',
                    append_to: this.handle_group,
                }),
            );
        }

        if (!this.gantt.options.readonly_progress) {
            this.$handle_progress = createSVG('circle', {
                cx: this.$bar_progress.getEndX(),
                cy: this.$bar_progress.getY() + this.$bar_progress.getHeight() / 2,
                r: 4.5,
                class: 'handle progress',
                append_to: this.handle_group,
            });
            this.handles.push(this.$handle_progress);
        }

        for (const handle of this.handles) {
            $.on(handle, 'mouseenter', () => handle.classList.add('active'));
            $.on(handle, 'mouseleave', () => handle.classList.remove('active'));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Position/Size (all via viewport)
    // ─────────────────────────────────────────────────────────────────────────

    getX() {
        return this.gantt.chart.viewport.dateToX(this.task.start);
    }

    getWidth() {
        return this.gantt.chart.viewport.dateToX(this.task.end) - this.getX();
    }

    getY() {
        const headerHeight = this.gantt.config.header_height;
        const padding = this.gantt.options.padding;
        const barHeight = this.gantt.options.bar_height;
        return headerHeight + padding / 2 + this.task._index * (barHeight + padding);
    }

    getHeight() {
        return this.gantt.options.bar_height;
    }

    getProgressWidth() {
        const progress = Math.max(0, Math.min(100, this.task.progress || 0));
        return (this.getWidth() * progress) / 100;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Visual Updates (during drag/resize, before task update)
    // ─────────────────────────────────────────────────────────────────────────

    updateBarPosition({ x = null, width = null }) {
        if (x !== null) {
            // Validate against dependencies
            const depXs = this.task.dependencies.map((dep) => {
                const depBar = this.gantt.getBar(dep);
                return depBar ? depBar.$bar.getX() : -Infinity;
            });
            const validX = depXs.every((depX) => x >= depX);
            if (!validX) return;

            this.$bar.setAttribute('x', x);
            this.$date_highlight.style.left = x + 'px';
        }

        if (width !== null) {
            const safeWidth = Math.max(0, width);
            this.$bar.setAttribute('width', safeWidth);
            this.$date_highlight.style.width = safeWidth + 'px';
        }

        this.updateLabelPosition();
        this.updateHandlePosition();
        this.updateProgressBarPosition();
        this.updateArrowPosition();
    }

    updateProgressBarPosition() {
        if (this.task.invalid || this.gantt.options.readonly) return;

        this.$bar_progress.setAttribute('x', this.$bar.getX());
        const barWidth = this.$bar.getWidth();
        const progress = Math.max(0, Math.min(100, this.task.progress || 0));
        const progressWidth = (barWidth * progress) / 100;
        this.$bar_progress.setAttribute('width', progressWidth);
    }

    updateLabelPosition() {
        const bar = this.$bar;
        const label = this.group.querySelector('.bar-label');
        const img = this.group.querySelector('.bar-img');
        const imgMask = this.bar_group.querySelector('.img_mask');

        if (!label) return;

        const padding = 5;
        const imageSize = this.getHeight() - 5;
        const xOffsetLabelImg = imageSize + 10;
        const labelWidth = label.getBBox().width;
        const barWidth = bar.getWidth();

        if (labelWidth > barWidth) {
            label.classList.add('big');
            if (img) {
                img.setAttribute('x', bar.getEndX() + padding);
                imgMask?.setAttribute('x', bar.getEndX() + padding);
                label.setAttribute('x', bar.getEndX() + xOffsetLabelImg);
            } else {
                label.setAttribute('x', bar.getEndX() + padding);
            }
        } else {
            label.classList.remove('big');
            if (img) {
                img.setAttribute('x', bar.getX() + padding);
                imgMask?.setAttribute('x', bar.getX() + padding);
                label.setAttribute('x', bar.getX() + barWidth / 2 + xOffsetLabelImg);
            } else {
                label.setAttribute('x', bar.getX() + barWidth / 2 - labelWidth / 2);
            }
        }
    }

    updateLabelPositionOnHorizontalScroll({ x, sx }) {
        const container = this.gantt.chart.$container;
        const label = this.group.querySelector('.bar-label');
        const img = this.group.querySelector('.bar-img');
        const imgMask = this.bar_group.querySelector('.img_mask');

        if (!label || label.classList.contains('big')) return;

        const barWidthLimit = this.$bar.getX() + this.$bar.getWidth();
        const newLabelX = label.getX() + x;
        const newImgX = img ? img.getX() + x : 0;
        const imgWidth = img ? img.getBBox().width + 7 : 7;
        const labelEndX = newLabelX + label.getBBox().width + 7;
        const viewportCentral = sx + container.clientWidth / 2;

        if (labelEndX < barWidthLimit && x > 0 && labelEndX < viewportCentral) {
            label.setAttribute('x', newLabelX);
            if (img) {
                img.setAttribute('x', newImgX);
                imgMask?.setAttribute('x', newImgX);
            }
        } else if (newLabelX - imgWidth > this.$bar.getX() && x < 0 && labelEndX > viewportCentral) {
            label.setAttribute('x', newLabelX);
            if (img) {
                img.setAttribute('x', newImgX);
                imgMask?.setAttribute('x', newImgX);
            }
        }
    }

    updateHandlePosition() {
        if (this.task.invalid || this.gantt.options.readonly) return;

        const leftHandle = this.handle_group.querySelector('.handle.left');
        const rightHandle = this.handle_group.querySelector('.handle.right');
        const progressHandle = this.group.querySelector('.handle.progress');

        if (leftHandle) {
            leftHandle.setAttribute('x', this.$bar.getX());
        }
        if (rightHandle) {
            rightHandle.setAttribute('x', this.$bar.getEndX());
        }
        if (progressHandle) {
            progressHandle.setAttribute('cx', this.$bar_progress.getEndX());
        }
    }

    updateArrowPosition() {
        for (const arrow of this.arrows) {
            arrow.update();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Binding
    // ─────────────────────────────────────────────────────────────────────────

    bind() {
        if (this.task.invalid) return;
        this.setupClickEvent();
    }

    setupClickEvent() {
        const taskId = this.task.uid;

        // Hover event
        $.on(this.group, 'mouseover', (e) => {
            this.gantt.triggerEvent('hover', [this.task, e.screenX, e.screenY, e]);
        });

        // Click popup
        if (this.gantt.options.popup_on === 'click') {
            $.on(this.group, 'mouseup', (e) => {
                const posX = e.offsetX || e.layerX;
                if (this.$handle_progress) {
                    const cx = +this.$handle_progress.getAttribute('cx');
                    if (cx > posX - 1 && cx < posX + 1) return;
                    if (this.gantt.bar_being_dragged) return;
                }
                this.gantt.showPopup({
                    x: e.offsetX || e.layerX,
                    y: e.offsetY || e.layerY,
                    task: this.task,
                    target: this.$bar,
                });
            });
        }

        // Hover popup with delay
        let timeout;
        $.on(this.group, 'mouseenter', (e) => {
            timeout = setTimeout(() => {
                if (this.gantt.options.popup_on === 'hover') {
                    this.gantt.showPopup({
                        x: e.offsetX || e.layerX,
                        y: e.offsetY || e.layerY,
                        task: this.task,
                        target: this.$bar,
                    });
                }
                this.gantt.chart.$container.querySelector(`.highlight-${taskId}`)?.classList.remove('hide');
            }, 200);
        });

        $.on(this.group, 'mouseleave', () => {
            clearTimeout(timeout);
            if (this.gantt.options.popup_on === 'hover') {
                this.gantt.chart.popup?.hide?.();
            }
            this.gantt.chart.$container.querySelector(`.highlight-${taskId}`)?.classList.add('hide');
        });

        // Click event
        $.on(this.group, 'click', () => {
            this.gantt.triggerEvent('click', [this.task]);
        });

        // Double click event
        $.on(this.group, 'dblclick', () => {
            if (this.action_completed) return;
            this.group.classList.remove('active');
            if (this.gantt.chart.popup) {
                this.gantt.chart.popup.parent.classList.remove('hide');
            }
            this.gantt.triggerEvent('double_click', [this.task]);
        });

        // Touch double tap
        let tapedTwice = false;
        $.on(this.group, 'touchstart', (e) => {
            if (!tapedTwice) {
                tapedTwice = true;
                setTimeout(() => {
                    tapedTwice = false;
                }, 300);
                return false;
            }
            e.preventDefault();

            if (this.action_completed) return;
            this.group.classList.remove('active');
            if (this.gantt.chart.popup) {
                this.gantt.chart.popup.parent.classList.remove('hide');
            }
            this.gantt.triggerEvent('double_click', [this.task]);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Interaction Callbacks (called by Gantt during drag/resize)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Compute start/end instants from current visual bar position
     * @returns {{ newStart: Temporal.Instant, newEnd: Temporal.Instant }}
     */
    computeStartEndFromPosition() {
        const newStart = this.gantt.chart.viewport.xToDate(this.$bar.getX());
        const newEnd = this.gantt.chart.viewport.xToDate(this.$bar.getEndX());
        return { newStart, newEnd };
    }

    /**
     * Compute progress percentage from current visual progress bar width
     * @returns {number} Progress percentage (0-100)
     */
    computeProgressFromPosition() {
        const progressWidth = this.$bar_progress.getWidth();
        const barWidth = this.$bar.getWidth();

        if (barWidth <= 0) return 0;

        const progress = Math.round((progressWidth / barWidth) * 100);
        return Math.max(0, Math.min(100, progress));
    }

    /**
     * Called when drag/resize action is completed
     */
    setActionCompleted() {
        this.action_completed = true;
        setTimeout(() => (this.action_completed = false), 1000);
    }
}
