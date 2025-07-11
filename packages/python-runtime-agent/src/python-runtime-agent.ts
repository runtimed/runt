import {
  Environment,
  PipEnvironmentManager,
} from './pip-environment-manager.ts';
import requirements from "./requirements.txt" with { type: "text" };

export class PythonRuntimeAgent {
  private envManager = new PipEnvironmentManager();
  private environment: Environment | null = null;

  constructor() {
    console.log('PythonRuntimeAgent constructor');
  }

  async start(): Promise<void> {
    console.log('PythonRuntimeAgent start (using imported requirements.txt)');
    this.environment = await this.envManager.createEnvironment({
      specs: requirements,
    });
    console.log(`Environment created at ${this.envManager.getEnvironmentPath(this.environment)}`);
  }

  async keepAlive(): Promise<void> {
    console.log('PythonRuntimeAgent keepAlive (stub)');
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }

  async shutdown(): Promise<void> {
    console.log('PythonRuntimeAgent shutdown (tearing down environment)');
    if (this.environment) {
      await this.envManager.deleteEnvironment(this.environment);
      this.environment = null;
      console.log('Environment deleted');
    }
  }
}
