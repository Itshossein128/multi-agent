"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentExecutionFailedError = exports.UnsupportedBackendError = void 0;
var types_1 = require("@multi-agent/types");
var UnsupportedBackendError = /** @class */ (function (_super) {
    __extends(UnsupportedBackendError, _super);
    function UnsupportedBackendError(backend, detail) {
        var _this = this;
        var key = "".concat(backend.type, "/").concat("provider" in backend ? backend.provider : "unknown");
        _this = _super.call(this, detail !== null && detail !== void 0 ? detail : "Executor not registered for backend: ".concat(key, " (").concat((0, types_1.agentBackendLabel)(backend), ")")) || this;
        _this.name = "UnsupportedBackendError";
        _this.backend = backend;
        return _this;
    }
    return UnsupportedBackendError;
}(Error));
exports.UnsupportedBackendError = UnsupportedBackendError;
var AgentExecutionFailedError = /** @class */ (function (_super) {
    __extends(AgentExecutionFailedError, _super);
    function AgentExecutionFailedError(message) {
        var _this = _super.call(this, message) || this;
        _this.name = "AgentExecutionFailedError";
        return _this;
    }
    return AgentExecutionFailedError;
}(Error));
exports.AgentExecutionFailedError = AgentExecutionFailedError;
//# sourceMappingURL=errors.js.map