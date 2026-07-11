export const bearerToken = (request) => request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";

export const tokensMatch = (provided, expected) => {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
};

export const publisherAuthorized = (request, env) => Boolean(env.PUBLISHER_TOKEN)
  && tokensMatch(bearerToken(request), env.PUBLISHER_TOKEN);
