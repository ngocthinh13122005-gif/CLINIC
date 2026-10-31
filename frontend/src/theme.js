import { createTheme } from '@mui/material/styles';
export const theme=createTheme({
  palette:{
    mode:'light',
    primary:{main:'#0d7a8a',dark:'#0a5f6c',light:'#e5f3f5'},
    background:{default:'#f5f8fa',paper:'#ffffff'},
    text:{primary:'#10253a',secondary:'#6b7c8d'},
    divider:'#e3eaf0'
  },
  typography:{fontFamily:'"Inter","Segoe UI", Roboto, Arial, sans-serif',fontSize:14,htmlFontSize:16,body1:{fontSize:14},body2:{fontSize:13},caption:{fontSize:12},button:{textTransform:'none',fontSize:14}},
  shape:{borderRadius:12},
  components:{MuiCssBaseline:{styleOverrides:{body:{margin:0}}},MuiPaper:{styleOverrides:{root:{backgroundImage:'none'}}}}
});
