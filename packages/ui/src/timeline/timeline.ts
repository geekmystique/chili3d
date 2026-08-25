// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IView, Localize, PubSub } from "@chili3d/core";
import { span } from "@chili3d/element";
import style from "./timeline.module.css";
import { TimelineTrack } from "./timelineTrack";

/** The always-visible timeline strip docked under the viewport, one track per open document. */
export class Timeline extends HTMLElement {
    private readonly _documentTrackMap = new Map<IDocument, TimelineTrack>();
    private _activeDocument: IDocument | undefined;

    activeTrack(): TimelineTrack | undefined {
        if (!this._activeDocument) return undefined;
        return this._documentTrackMap.get(this._activeDocument);
    }

    constructor(props: { className: string }) {
        super();
        this.classList.add(style.root, props.className);
        this.append(span({ className: style.label, textContent: new Localize("timeline.header") }));
        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
        PubSub.default.sub("documentClosed", this.handleDocumentClosed);
    }

    private readonly handleDocumentClosed = (document: IDocument) => {
        const track = this._documentTrackMap.get(document);
        if (track) {
            track.remove();
            track.dispose();
            this._documentTrackMap.delete(document);
        }
    };

    private readonly handleActiveViewChanged = (view: IView | undefined) => {
        if (this._activeDocument === view?.document) return;

        this._documentTrackMap.get(this._activeDocument!)?.remove();
        this._activeDocument = view?.document;

        if (view) {
            let track = this._documentTrackMap.get(view.document);
            if (!track) {
                track = new TimelineTrack(view.document);
                this._documentTrackMap.set(view.document, track);
            }
            this.append(track);
        }
    };
}

customElements.define("chili-timeline", Timeline);
