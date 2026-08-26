// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command } from "@chili3d/core";
import { Move } from "./move";
import { placementEditOf } from "./placementEditMixin";

@command({
    key: "modify.placementMoveEdit",
    icon: "icon-move",
})
export class PlacementMoveEditCommand extends placementEditOf(Move) {}
