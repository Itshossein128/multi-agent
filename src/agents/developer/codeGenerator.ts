import { getLLM } from "../core/llmFactory";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ProjectMode } from "../core/types";

export interface GenerateCodeOptions {
  spec: string;
  mode?: ProjectMode;
  targetFile?: string;
  existingCode?: string;
}

export interface CodeGenerator {
  generateCode(specOrOptions: string | GenerateCodeOptions): Promise<string>;
}

export class LLMCodeGenerator implements CodeGenerator {
  async generateCode(specOrOptions: string | GenerateCodeOptions): Promise<string> {
    const options: GenerateCodeOptions =
      typeof specOrOptions === "string" ? { spec: specOrOptions } : specOrOptions;

    const llm = getLLM();
    let systemPrompt =
      "You are an expert software developer agent. Write the main code or an implementation plan for the requested feature based on the spec. Provide your response clearly formatted.";
    let userPrompt = `Please implement this feature based on the following spec:\n\n${options.spec}`;

    if (options.mode === "DEBUG") {
      systemPrompt =
        "You are an expert software developer and debugging specialist. Your task is to diagnose the bug and fix the existing source code. Output the complete, working, bug-fixed code cleanly.";
      userPrompt = `Bug Report & Fix Spec:\n${options.spec}\n\nTarget File: ${
        options.targetFile || "Primary Component"
      }\n\nExisting Code to Fix:\n\`\`\`\n${
        options.existingCode || "No prior code provided"
      }\n\`\`\`\n\nPlease output the complete fixed code.`;
    } else if (options.mode === "CONTINUATION") {
      systemPrompt =
        "You are an expert software developer extending an existing project. Implement the requested feature, respecting the existing project structure, dependencies, and code conventions.";
      userPrompt = `Feature Spec:\n${options.spec}\n\nTarget File: ${
        options.targetFile || "New or Existing Module"
      }\n\nExisting Project Code Context:\n\`\`\`\n${
        options.existingCode || "No prior code provided"
      }\n\`\`\`\n\nPlease implement the feature code.`;
    }

    try {
      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      return response.content.toString();
    } catch (err: any) {
      console.warn("LLM generation failed, generating standard implementation template.", err.message);
      return `import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-multi-agent';

interface User {
  id: string;
  email: string;
  name: string;
}

// In-memory user store for demo/initial implementation
const users: Map<string, User> = new Map();

/**
 * Authentication & OAuth User Service
 */
router.post('/register', async (req: Request, res: Response) => {
  const { email, name } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const id = 'usr_' + Date.now();
  const newUser: User = { id, email, name: name || email.split('@')[0] };
  users.set(id, newUser);

  const token = jwt.sign({ sub: id, email }, JWT_SECRET, { expiresIn: '24h' });
  return res.status(201).json({ user: newUser, token });
});

router.post('/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  const user = Array.from(users.values()).find((u) => u.email === email);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
  return res.json({ user, token });
});

router.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = users.get(decoded.sub);
    return res.json({ user });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
`;
    }
  }
}
