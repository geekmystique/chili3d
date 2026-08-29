// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape } from "@chili3d/core";

export function repairShape(shape: IShape, tolerance: number): IShape {
    const getShapeIfNotNull = (testShape: IShape, defaultShape: IShape) => {
        return testShape.isNull() ? defaultShape : testShape;
    };
    let repairedShape = getShapeIfNotNull(shape.shellSewing(tolerance), shape);
    repairedShape = getShapeIfNotNull(repairedShape.fixShape(tolerance), repairedShape);
    repairedShape = getShapeIfNotNull(repairedShape.fixSmallFace(tolerance), repairedShape);
    return repairedShape;
}
