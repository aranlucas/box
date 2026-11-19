import { Redirect } from 'expo-router';

/**
 * Android delivers the sign-in return (boxes://auth?code=…) to both expo-web-browser (which
 * finishes the exchange) and Expo Router. This route just sends the router home instead of
 * showing "Unmatched route".
 */
export default function AuthReturn() {
  return <Redirect href="/" />;
}
