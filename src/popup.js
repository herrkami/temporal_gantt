/**
 * Popup - Task detail popup component
 *
 * Displays task information on hover/click.
 * Content is customizable via popup_func.
 */
export default class Popup {
    /**
     * @param {HTMLElement} parent - Container element for the popup
     * @param {Function} popupFunc - Function that populates popup content
     * @param {Gantt} gantt - Reference to the Gantt instance
     */
    constructor(parent, popupFunc, gantt) {
        this.parent = parent;
        this.popupFunc = popupFunc;
        this.gantt = gantt;

        this.init();
    }

    init() {
        this.parent.innerHTML = `
            <div class="title"></div>
            <div class="subtitle"></div>
            <div class="details"></div>
            <div class="actions"></div>
        `;
        this.hide();

        this.title = this.parent.querySelector('.title');
        this.subtitle = this.parent.querySelector('.subtitle');
        this.details = this.parent.querySelector('.details');
        this.actions = this.parent.querySelector('.actions');
    }

    /**
     * Show the popup with task information
     * @param {Object} opts - Display options
     * @param {number} opts.x - X position
     * @param {number} opts.y - Y position
     * @param {Task} opts.task - Task to display
     * @param {Element} opts.target - Target element (bar)
     */
    show({ x, y, task, target }) {
        this.actions.innerHTML = '';

        const html = this.popupFunc({
            task,
            target,
            chart: this.gantt,
            get_title: () => this.title,
            set_title: (title) => (this.title.innerHTML = title),
            get_subtitle: () => this.subtitle,
            set_subtitle: (subtitle) => (this.subtitle.innerHTML = subtitle),
            get_details: () => this.details,
            set_details: (details) => (this.details.innerHTML = details),
            add_action: (html, func) => {
                const action = document.createElement('button');
                action.className = 'action-btn';
                this.actions.appendChild(action);
                if (typeof html === 'function') html = html(task);
                action.innerHTML = html;
                action.onclick = (e) => func(task, this.gantt, e);
            },
        });

        if (html === false) return;
        if (html) this.parent.innerHTML = html;

        if (this.actions.innerHTML === '') this.actions.remove();
        else this.parent.appendChild(this.actions);

        this.parent.style.left = x + 10 + 'px';
        this.parent.style.top = y - 10 + 'px';
        this.parent.classList.remove('hide');
    }

    hide() {
        this.parent.classList.add('hide');
    }
}