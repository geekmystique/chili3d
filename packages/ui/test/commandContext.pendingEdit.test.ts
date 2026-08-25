// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { AsyncController, I18nKeys } from "@chili3d/core";
import { CommandStore, Observable, PubSub, property } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";

// CSS module under test
rs.mock("../src/ribbon/commandContext.module.css", () => ({
    panel: "cc-panel",
    container: "cc-container",
    command: "cc-command",
    icon: "cc-icon",
    title: "cc-title",
    cancelButton: "cc-cancel",
    selectionButton: "cc-selection-button",
    selectionControl: "cc-selection-control",
    selectionInfo: "cc-selection-info",
    selectionCount: "cc-selection-count",
    selectionCountLabel: "cc-selection-count-label",
    group: "cc-group",
    select: "cc-select",
    input: "cc-input",
    button: "cc-button",
    materialButton: "cc-material-button",
}));

// Real click()/focus()/blur() dispatch is needed here - the bug this file
// covers only reproduces through actual DOM focus transfer, not through the
// `_on*` direct-invocation shortcut the other commandContext tests use.
import "./_helpers/mockElementRealEvents";

import { CommandContext } from "../src/ribbon/commandContext";
import { mustQuery } from "./_helpers/domHelpers";

const CMD_KEY = "test.context.pendingEdit";

class SizeCommand extends Observable {
    async execute() {}
    cancel = rs.fn(async () => {});

    private _size = 60;
    @property("test.size" as I18nKeys)
    get size() {
        return this._size;
    }
    set size(value: number) {
        this._size = value;
    }
}

describe("CommandContext - pending edit commit on confirm", () => {
    let ctx: CommandContext;

    beforeEach(() => {
        CommandStore.registerCommand(SizeCommand, { key: CMD_KEY, icon: "icon-ctx" });
    });

    afterEach(() => {
        PubSub.default.pub("clearSelectionControl");
        ctx?.remove();
        ctx?.dispose();
        CommandStore.unregisterCommand(CMD_KEY);
    });

    test("should commit a value typed into a number field before confirming, even without blurring first", () => {
        const command = new SizeCommand();
        ctx = new CommandContext(command);
        document.body.appendChild(ctx);

        const controller = { success: rs.fn(() => {}), cancel: rs.fn(() => {}) };
        PubSub.default.pub("showSelectionControl", controller as unknown as AsyncController);

        const input = mustQuery<HTMLInputElement>(ctx, "input[type='text']");
        input.focus();
        input.value = "10";
        // No blur() and no Enter here - the click below must flush the edit itself.
        expect(document.activeElement).toBe(input);

        const confirmButton = mustQuery(ctx, ".cc-selection-control .cc-selection-button");
        confirmButton.click();

        expect(command.size).toBe(10);
        expect(controller.success).toHaveBeenCalledTimes(1);
    });

    test("should not disturb focus that isn't inside this panel", () => {
        const command = new SizeCommand();
        ctx = new CommandContext(command);
        document.body.appendChild(ctx);

        const outside = document.createElement("input");
        document.body.appendChild(outside);
        outside.focus();
        expect(document.activeElement).toBe(outside);

        const controller = { success: rs.fn(() => {}), cancel: rs.fn(() => {}) };
        PubSub.default.pub("showSelectionControl", controller as unknown as AsyncController);
        const confirmButton = mustQuery(ctx, ".cc-selection-control .cc-selection-button");
        confirmButton.click();

        expect(command.size).toBe(60);
        outside.remove();
    });
});
