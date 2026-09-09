"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolExecutorFactory = exports.ToolExecutorFactory = void 0;
const functionToolExecutor_1 = require("./functionToolExecutor");
const notImplementedToolExecutor_1 = require("./notImplementedToolExecutor");
class ToolExecutorFactory {
    create(category) {
        if (category === "function")
            return new functionToolExecutor_1.FunctionToolExecutor();
        return new notImplementedToolExecutor_1.NotImplementedToolExecutor(category);
    }
}
exports.ToolExecutorFactory = ToolExecutorFactory;
exports.toolExecutorFactory = new ToolExecutorFactory();
//# sourceMappingURL=toolExecutorFactory.js.map