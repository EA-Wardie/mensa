import * as core from "@opentui/core";
import { ctx } from "../lib/context";
import { DatabaseFooter } from "./DatabaseFooter";
import { DataGrid } from "./DataGrid";
import { Flex } from "./Flex";
import { QueryView } from "./QueryView";
import { RowEditor } from "./RowEditor";
import { TableSidebar } from "./TableSidebar";
import { TableTabs } from "./TableTabs";

export class DatabaseScreen {
	private _component: core.BoxRenderable;

	constructor() {
		const grid: DataGrid = DataGrid.make();

		this._component = new core.BoxRenderable(ctx, {
			width: "100%",
			height: "100%",
			flexDirection: "row",
		});

		this._component.add(TableSidebar.make());
		this._component.add(
			Flex.make({
				flexGrow: 1,
				flexShrink: 1,
				width: "auto",
				components: [
					TableTabs.make(),
					grid,
					QueryView.host(grid),
					DatabaseFooter.make(),
				],
			}),
		);
		this._component.add(RowEditor.host());
	}

	public static make(): core.BoxRenderable {
		return new this()._component;
	}
}
