// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";

// Mock CSS modules
rs.mock("../src/statusbar/snapConfig.module.css", () => ({
    container: "sc-container",
    gridSize: "sc-grid-size",
}));

// Mock element helpers — snap tests trigger handlers via el.click(),
// so the realEvents variant is needed
import "./_helpers/mockElementRealEvents";

import { SnapConfig } from "../src/statusbar/snapConfig";
import { mustQuery } from "./_helpers/domHelpers";

describe("SnapConfig", () => {
    let originalSnapType: ObjectSnapType;
    let originalEnableSnap: boolean;
    let originalEnableSnapTracking: boolean;
    let originalGridSize: number;

    beforeEach(() => {
        originalSnapType = Config.instance.snapType;
        originalEnableSnap = Config.instance.enableSnap;
        originalEnableSnapTracking = Config.instance.enableSnapTracking;
        originalGridSize = Config.instance.gridSize;

        // Set defaults for consistent testing
        Config.instance.enableSnap = true;
        Config.instance.enableSnapTracking = true;
    });

    afterEach(() => {
        Config.instance.snapType = originalSnapType;
        Config.instance.enableSnap = originalEnableSnap;
        Config.instance.enableSnapTracking = originalEnableSnapTracking;
        Config.instance.gridSize = originalGridSize;
    });

    describe("constructor", () => {
        test("should render snap type checkboxes", () => {
            const config = new SnapConfig();
            const checkboxes = config.querySelectorAll('input[type="checkbox"]');
            // 9 snap types + 1 tracking toggle = 10 checkboxes
            expect(checkboxes.length).toBe(10);
        });

        test("should set container CSS class", () => {
            const config = new SnapConfig();
            expect(config.className).toContain("sc-container");
        });

        test("should create checkboxes with id prefix snap-", () => {
            const config = new SnapConfig();
            const snapCheckboxes = config.querySelectorAll('input[id^="snap-"]');
            // 10 total checkboxes, all should start with snap- prefix
            expect(snapCheckboxes.length).toBe(10);
        });

        test("should create tracking checkbox", () => {
            const config = new SnapConfig();
            const trackingCheckbox = mustQuery<HTMLInputElement>(config, "#snap-tracking");
            expect(trackingCheckbox.checked).toBe(true);
        });

        test("should render labels for each checkbox", () => {
            const config = new SnapConfig();
            const labels = config.querySelectorAll("label");
            // 9 snap type labels + 1 tracking label = 10
            expect(labels.length).toBe(10);
        });
    });

    describe("snap type toggling", () => {
        test("should toggle snap type when checkbox clicked", () => {
            const config = new SnapConfig();
            // SnapTypes[i].type is a numeric enum value, so the id format is snap-{number}
            const endPointId = `snap-${ObjectSnapTypes.endPoint}`;
            const endPointCheckbox = mustQuery<HTMLInputElement>(config, `#${endPointId}`);

            const hadType = ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.endPoint);

            endPointCheckbox.click();

            const nowHasType = ObjectSnapTypeUtils.hasType(
                Config.instance.snapType,
                ObjectSnapTypes.endPoint,
            );

            // After clicking, the type should toggle
            expect(nowHasType).toBe(!hadType);
        });
    });

    describe("tracking toggle", () => {
        test("should toggle enableSnapTracking when tracking checkbox is clicked", () => {
            Config.instance.enableSnapTracking = true;
            const config = new SnapConfig();
            const trackingCheckbox = mustQuery<HTMLInputElement>(config, "#snap-tracking");
            trackingCheckbox.click();
            expect(Config.instance.enableSnapTracking).toBe(false);
        });
    });

    describe("config change reactivity", () => {
        test.each([
            { prop: "snapType" },
            { prop: "enableSnap" },
            { prop: "enableSnapTracking" },
        ])("should re-render when $prop config changes", ({ prop }) => {
            const config = new SnapConfig();
            const firstCheckboxBefore = mustQuery(config, 'input[type="checkbox"]');

            // Manually trigger the property changed callback
            (config as unknown as { snapTypeChanged: (p: string) => void }).snapTypeChanged(prop);

            // Content should be regenerated: same count, new element instances
            const checkboxes = config.querySelectorAll('input[type="checkbox"]');
            expect(checkboxes.length).toBe(10);
            expect(checkboxes[0]).not.toBe(firstCheckboxBefore);
        });

        test("should NOT clear checkboxes for unrelated config changes", () => {
            const config = new SnapConfig();
            (config as unknown as { snapTypeChanged: (prop: string) => void }).snapTypeChanged("language");
            // The snapTypeChanged method only clears on snapType/enableSnap/enableSnapTracking
            // For "language", innerHTML should NOT have been cleared
            expect(config.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
        });
    });

    describe("grid size input", () => {
        test("should not render the grid size input when grid snapping is off", () => {
            Config.instance.snapType = ObjectSnapTypeUtils.removeType(
                Config.instance.snapType,
                ObjectSnapTypes.grid,
            );
            const config = new SnapConfig();
            expect(config.querySelector("#snap-grid-size")).toBeNull();
        });

        test("should render the grid size input, prefilled with the current size, once grid snapping is on", () => {
            Config.instance.gridSize = 5;
            Config.instance.snapType = ObjectSnapTypeUtils.addType(
                Config.instance.snapType,
                ObjectSnapTypes.grid,
            );
            const config = new SnapConfig();
            const gridSizeInput = mustQuery<HTMLInputElement>(config, "#snap-grid-size");
            expect(gridSizeInput.value).toBe("5");
        });

        test("should commit a valid typed size on blur", () => {
            Config.instance.snapType = ObjectSnapTypeUtils.addType(
                Config.instance.snapType,
                ObjectSnapTypes.grid,
            );
            const config = new SnapConfig();
            const gridSizeInput = mustQuery<HTMLInputElement>(config, "#snap-grid-size");
            gridSizeInput.value = "2.5";
            gridSizeInput.dispatchEvent(new Event("blur"));
            expect(Config.instance.gridSize).toBe(2.5);
        });

        test("should ignore a non-positive or non-numeric typed size on blur", () => {
            Config.instance.gridSize = 10;
            Config.instance.snapType = ObjectSnapTypeUtils.addType(
                Config.instance.snapType,
                ObjectSnapTypes.grid,
            );
            const config = new SnapConfig();
            const gridSizeInput = mustQuery<HTMLInputElement>(config, "#snap-grid-size");

            gridSizeInput.value = "0";
            gridSizeInput.dispatchEvent(new Event("blur"));
            expect(Config.instance.gridSize).toBe(10);

            gridSizeInput.value = "not-a-number";
            gridSizeInput.dispatchEvent(new Event("blur"));
            expect(Config.instance.gridSize).toBe(10);
        });

        test("should toggle grid snapping when its checkbox is clicked", () => {
            Config.instance.snapType = ObjectSnapTypeUtils.removeType(
                Config.instance.snapType,
                ObjectSnapTypes.grid,
            );
            const config = new SnapConfig();
            const gridCheckbox = mustQuery<HTMLInputElement>(config, `#snap-${ObjectSnapTypes.grid}`);

            gridCheckbox.click();

            expect(ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.grid)).toBe(true);
        });
    });
});
