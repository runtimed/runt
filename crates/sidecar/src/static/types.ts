type Header<MsgType> = {
	msg_type: MsgType;
};

export type JupyterWidgetDisplayData = {
	model_id: string;
	version_major: number;
	version_minor: number;
};

type Mimebundle = {
	["text/plain"]?: string;
	["text/html"]?: string;
	["application/vnd.jupyter.widget-view+json"]?: JupyterWidgetDisplayData;
};

export type DisplayData = {
	header: Header<"display_data">;
	content: {
		data: Mimebundle;
		execution_count: number;
	};
};

export type ExecuteResult = {
	header: Header<"execute_result">;
	content: {
		data: Mimebundle;
		execution_count: number;
	};
};

export type CommOpen = {
	header: Header<"comm_open">;
	content: {
		comm_id: string;
		target_name: "jupyter.widget";
		data: {
			buffer_paths: string[];
			state: Record<string, unknown>;
		};
	};
};

export type JupyterMessage = DisplayData | ExecuteResult | CommOpen;
