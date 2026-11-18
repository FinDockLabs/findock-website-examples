import { LightningElement, api } from 'lwc';

// Lightning Out renders this component in an iframe that doesn't grow with its content,
// so tell the embedding page how tall the pay link is whenever it changes.
const RESIZE_MESSAGE = 'findock-resize';

export default class PayLinkFlow extends LightningElement {
    // GUID of the installment or recurring payment to pay (record-guid).
    @api recordGuid;
    // "invoice" (default) or "link": an invoice shows To / Invoice rows, a payment link only From / For.
    @api linkType;
    // Optional link to the invoice PDF, shown as a thumbnail in the card.
    @api invoiceUrl;
    // Name shown in the From row; defaults to the Salesforce organization name.
    @api merchantName;
    // Set by the host page (success-url / failure-url) so hosted payments return to the embedding site.
    @api successUrl;
    @api failureUrl;

    resizeObserver;
    lastHeight = 0;
    // Heights are only reported once the flow shows its first screen. Before that the frame holds only the
    // flow's loading spinner, and reporting its height would make the host page drop its skeleton too early.
    screenShown = false;

    get inputVariables() {
        const values = {
            id: this.recordGuid,
            type: this.linkType,
            invoiceUrl: this.invoiceUrl,
            merchantName: this.merchantName,
            successUrl: this.successUrl,
            failureUrl: this.failureUrl,
        };
        return Object.entries(values)
            .filter(([, value]) => value)
            .map(([name, value]) => ({ name, type: 'String', value }));
    }

    handleStatusChange() {
        if (!this.screenShown) {
            this.screenShown = true;
            this.postHeight();
        }
    }

    renderedCallback() {
        if (this.resizeObserver || window.parent === window) {
            return;
        }
        this.resizeObserver = new ResizeObserver(() => this.postHeight());
        this.resizeObserver.observe(this.refs.root);
        this.postHeight();
    }

    disconnectedCallback() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    postHeight() {
        if (!this.screenShown || window.parent === window) {
            return;
        }
        // The bottom edge, not the height: anything above the root in the frame (body margin, Lightning Out's own wrapper)
        // would otherwise be cut off at the bottom of the frame.
        const height = Math.ceil(this.refs.root.getBoundingClientRect().bottom + window.scrollY);
        if (height && height !== this.lastHeight) {
            this.lastHeight = height;
            // Only a height is shared, so any embedding origin may receive it.
            window.parent.postMessage({ type: RESIZE_MESSAGE, height }, '*');
        }
    }
}
