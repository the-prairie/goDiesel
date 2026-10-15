import { discoveryResponse } from "../../app/server/discovery";
export const onRequest = ({ request }: { request: Request }) =>
  discoveryResponse(request);
