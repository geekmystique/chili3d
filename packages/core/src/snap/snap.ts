// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { I18nKeys } from "../i18n";
import type { Plane, XYZ } from "../math";
import type { VisualNode } from "../model";
import type { IShapeFilter } from "../selectionFilter";
import type { ShapeMeshData } from "../shape";
import type { IView, VisualShapeData } from "../visual";

export interface SnapData {
    preview?: (point: XYZ | undefined) => ShapeMeshData[];
    prompt?: (point: SnapResult) => string;
    filter?: IShapeFilter;
    validator?: (point: XYZ) => boolean;
    featurePoints?: {
        point: XYZ;
        prompt: string;
        when?: () => boolean;
    }[];
    beforeExecute?: () => void;
    afterExecute?: () => void;
    onKeyDown?: (key: KeyboardEvent, update: () => void) => void;
    /**
     * If provided, Enter/Space finishes the step with this value (the same
     * as typing it and pressing Enter in a bound properties-panel field)
     * instead of the default cancel - for a step whose current/default value
     * is already meaningful on its own (e.g. a radius/length box visible
     * from the start of the command), so accepting the suggestion doesn't
     * require first clicking into that field.
     */
    acceptOnEnter?: () => number;
    /**
     * If true, pointerMove is ignored unless Ctrl is held - for a step whose
     * "drag" is really just continuous mouse movement over the 3D view (e.g.
     * setting a radius/length by pulling), so casually moving the mouse
     * around (to look at the model, say) doesn't silently change the value;
     * holding Ctrl is the explicit "I'm dragging now" gesture. The value
     * stays exactly where it was left once Ctrl is released - this only
     * gates updates, it never resets anything.
     */
    requireCtrlToDrag?: boolean;
}

export type SnapType =
    | "node"
    | "shape"
    | "vertex"
    | "center"
    | "end"
    | "perpendicular"
    | "intersection"
    | "tangent"
    | "nearCurve"
    | "trace"
    | "traceIntersect"
    | "onSurface"
    | "middle"
    | "axis"
    | "feature"
    | "input"
    | "angle"
    | "grid";

export interface SnapResult {
    view: IView;
    type: SnapType;
    point?: XYZ;
    info?: string;
    distance?: number;
    refPoint?: XYZ;
    shapes: VisualShapeData[];
    nodes?: VisualNode[];
    plane?: Plane;
}

export interface MouseAndDetected {
    view: IView;
    mx: number;
    my: number;
    shapes: VisualShapeData[];
}

export interface ISnap {
    snap(data: MouseAndDetected): SnapResult | undefined;
    readonly handleSnaped?: (document: IDocument, snaped?: SnapResult) => void;
    removeDynamicObject(): void;
    clear(): void;
}
