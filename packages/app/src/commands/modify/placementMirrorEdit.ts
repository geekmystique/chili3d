// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command } from "@chili3d/core";
import { Mirror } from "./mirror";
import { placementEditOf } from "./placementEditMixin";

@command({
    key: "modify.placementMirrorEdit",
    icon: "icon-mirror",
})
export class PlacementMirrorEditCommand extends placementEditOf(Mirror) {}
