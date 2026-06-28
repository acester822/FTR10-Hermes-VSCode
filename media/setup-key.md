# Secure your API Key

Your API key is **never** stored in `settings.json` or written to disk as plain text. We use VS Code's built-in **Secret Storage**, which is encrypted at rest.

## Steps

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Hermes: Set API Key**
3. Paste your API key into the prompt (it will be masked)

> Your key is stored securely and only used for ACP authentication with the Hermes agent.

## Where to get an API Key

- **OpenRouter**: https://openrouter.ai/keys
- **Anthropic**: https://console.anthropic.com/
- **OpenAI**: https://platform.openai.com/api-keys

Once your key is stored, you can configure the model and provider in the **Control Center** sidebar.
