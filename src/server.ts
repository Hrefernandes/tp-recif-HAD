import { createApp } from "./app.js";
import { config } from "./config.js";

createApp().listen(config.port, () => {
  console.log(`Le Récif API sur http://localhost:${config.port}`);
});
