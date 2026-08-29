// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command } from "@chili3d/core";
import { placementEditOf } from "./placementEditMixin";
import { Rotate } from "./rotate";

@command({
    key: "modify.placementRotateEdit",
    icon: "icon-rotate",
})
export class PlacementRotateEditCommand extends placementEditOf(Rotate) {}
