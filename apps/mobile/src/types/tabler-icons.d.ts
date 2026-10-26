/**
 * @tabler/icons-react-native 3.49 maps per-icon types to dist/icons/*.d.ts, but ships
 * them under dist/icons/icons/. Declare the deep imports so we can import one icon per
 * file instead of the barrel (thousands of icons).
 */
declare module '@tabler/icons-react-native/*' {
  import type { ForwardRefExoticComponent } from 'react';
  import type { SvgProps } from 'react-native-svg';

  interface IconProps extends SvgProps {
    size?: string | number;
    strokeWidth?: string | number;
    title?: string;
  }
  const Icon: ForwardRefExoticComponent<IconProps>;
  export default Icon;
}
