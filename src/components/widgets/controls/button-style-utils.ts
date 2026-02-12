type ButtonStyleVariant = "default" | "destructive" | "outline";

interface ButtonStyleResult {
  variant: ButtonStyleVariant;
  className: string;
}

const BUTTON_STYLE_MAP: Record<string, ButtonStyleResult> = {
  primary: {
    variant: "default",
    className: "bg-blue-600 text-white hover:bg-blue-700",
  },
  success: {
    variant: "default",
    className: "bg-green-600 text-white hover:bg-green-700",
  },
  info: {
    variant: "default",
    className: "bg-sky-600 text-white hover:bg-sky-700",
  },
  warning: {
    variant: "default",
    className: "bg-amber-500 text-white hover:bg-amber-600",
  },
  danger: {
    variant: "destructive",
    className: "",
  },
  "": {
    variant: "outline",
    className: "",
  },
};

const DEFAULT_STYLE: ButtonStyleResult = { variant: "outline", className: "" };

export function getButtonStyle(buttonStyle: string): ButtonStyleResult {
  return BUTTON_STYLE_MAP[buttonStyle] ?? DEFAULT_STYLE;
}
