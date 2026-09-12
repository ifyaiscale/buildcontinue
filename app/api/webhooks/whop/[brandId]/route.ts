import { handleApi } from "../../../../../lib/server/api";
import { signedProviderRoute } from "../../../../../lib/server/http";

const handler = signedProviderRoute(handleApi);
export { handler as POST };
