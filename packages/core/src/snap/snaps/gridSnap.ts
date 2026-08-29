// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Plane, XYZ } from "../../math";
import { ViewUtils } from "../../visual";
import type { ISnap, MouseAndDetected, SnapResult } from "../snap";

/**
 * Snaps the cursor to the nearest intersection of an evenly-spaced grid laid
 * out on a plane (the active workplane by default). Unlike ObjectSnap/
 * TrackingSnap, this always produces a result wherever the cursor is - so it
 * must be ordered last among a handler's snaps, a fallback for empty space
 * rather than something that should ever outrank an actual geometry snap.
 */
export class GridSnap implements ISnap {
    constructor(
        readonly gridSize: () => number,
        readonly plane?: (point: XYZ) => Plane,
        readonly refPoint?: () => XYZ,
    ) {}

    removeDynamicObject(): void {}

    clear(): void {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        const size = this.gridSize();
        if (!(size > 0)) return undefined;

        const raw = data.view.screenToWorld(data.mx, data.my);
        const plane = ViewUtils.ensurePlane(data.view, this.plane ? this.plane(raw) : data.view.workplane);
        const ray = data.view.rayAt(data.mx, data.my);
        const hit = plane.intersectRay(ray);
        if (!hit) return undefined;

        const point = this.roundToGrid(plane, hit, size);
        const distance = this.refPoint ? this.refPoint().distanceTo(point) : undefined;

        return { view: data.view, point, distance, shapes: [], type: "grid", plane };
    }

    private roundToGrid(plane: Plane, point: XYZ, size: number): XYZ {
        const relative = point.sub(plane.origin);
        const u = Math.round(relative.dot(plane.xvec) / size) * size;
        const v = Math.round(relative.dot(plane.yvec) / size) * size;
        return plane.origin.add(plane.xvec.multiply(u)).add(plane.yvec.multiply(v));
    }
}
